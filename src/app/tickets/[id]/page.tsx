import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { threads, mailboxes, messages, macros } from "@/db/schema";
import AppShell from "@/app/_components/AppShell";
import ReplyArea from "./_components/ReplyArea";
import UnsubscribeButton from "./_components/UnsubscribeButton";
import { StatusForm, CategoryForm } from "./_components/PropertyForms";
import {
  getAiSettingsSafe,
  getLatestSuggestion,
  getSuggestionSources,
} from "@/lib/ai";
import { isAiConfigured } from "@/lib/deepseek";
import {
  STATUS_LABELS,
  colorClass,
  fmtDateTime,
  fmtRelative,
  initials,
} from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const threadId = Number(id);
  if (!Number.isInteger(threadId)) notFound();

  const [thread] = await db
    .select()
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!thread) notFound();

  const [mailbox] = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.id, thread.mailboxId))
    .limit(1);

  // Sem operação definida, cai no rótulo da caixa.
  const operationName = mailbox?.operation || mailbox?.label || "—";

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt));

  // Só as respostas prontas desta caixa — mais as sem caixa, legado de antes
  // da segmentação, que valem para todas.
  const macroList = await db
    .select({
      id: macros.id,
      title: macros.title,
      body: macros.body,
      shortcut: macros.shortcut,
    })
    .from(macros)
    .where(or(eq(macros.mailboxId, thread.mailboxId), isNull(macros.mailboxId)))
    .orderBy(macros.title);

  // Rascunho da IA pendente para esta conversa, se houver. Tudo aqui é
  // tolerante a falha: o chamado precisa abrir mesmo com a IA indisponível.
  const settings = await getAiSettingsSafe();
  const action = await getLatestSuggestion(threadId);
  const suggestion = action
    ? {
        id: action.id,
        summary: action.summary,
        draft: action.responseSent,
        confidence: action.confidence,
        category: action.categorySuggested,
        model: action.model,
        errorMessage: action.errorMessage,
        sources: await getSuggestionSources(action.sourceArticleIds),
      }
    : null;

  const lastInbound = [...msgs].reverse().find((m) => m.direction === "inbound");

  const aiUnavailableReason = !isAiConfigured()
    ? "DEEPSEEK_API_KEY não está configurada no ambiente."
    : !settings.enabled
      ? "A geração automática está desligada nas configurações da base de conhecimento."
      : "Você pode gerar sob demanda.";

  return (
    <AppShell>
      <section className="page">
        <div>
          <div className="breadcrumb">
            <Link href="/tickets">Respostas</Link>
            <span>/</span>
            <span className="mono">#{thread.id}</span>
          </div>
          <h1 style={{ fontSize: 26 }}>{thread.subject || "(sem assunto)"}</h1>
          <div className="chips" style={{ marginTop: 12 }}>
            <span className={`tag ${colorClass(thread.mailboxId)}`}>
              {operationName}
            </span>
            <span className={`badge st-${thread.status}`}>
              {STATUS_LABELS[thread.status] ?? thread.status}
            </span>
            <span className="badge neutral">
              {msgs.length} mensagem{msgs.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="thread-grid">
          <div className="thread-col">
            <div className="card">
              <div className="msg-list">
                {msgs.length === 0 ? (
                  <div className="empty">Nenhuma mensagem nesta thread.</div>
                ) : (
                  msgs.map((m) => {
                    const out = m.direction === "outbound";
                    return (
                      <div key={m.id} className={`msg ${m.direction}`}>
                        <div
                          className={`avatar lg ${out ? colorClass(m.sentByUserId) : "plain"}`}
                        >
                          {initials(m.fromAddr)}
                        </div>
                        <div className="msg-col">
                          <div className="msg-head">
                            <strong>{m.fromAddr || "(desconhecido)"}</strong>
                            <span>
                              {out ? "resposta" : "via e-mail"} ·{" "}
                              {fmtDateTime(m.sentAt ?? m.createdAt)}
                            </span>
                          </div>
                          <div className="msg-bubble">
                            {m.bodyText || "(sem corpo de texto)"}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <ReplyArea
              threadId={threadId}
              macros={macroList}
              suggestion={suggestion}
              lastInboundId={lastInbound?.id ?? null}
              signature={mailbox?.signature ?? null}
              aiUnavailableReason={aiUnavailableReason}
            />
          </div>

          <div className="thread-aside">
            <div className="card props">
              <span className="card-title">Propriedades</span>

              <StatusForm threadId={threadId} status={thread.status} />

              <div className="hr" />

              <CategoryForm threadId={threadId} category={thread.category} />

              <div className="hr" />

              <div className="prop-row">
                <span>Operação</span>
                <span className={`tag ${colorClass(thread.mailboxId)}`}>
                  {operationName}
                </span>
              </div>
              <div className="prop-row">
                <span>Criado</span>
                {/* Data do e-mail do cliente, não a da linha no banco: com o
                    backlog sendo ingerido agora, createdAt é o momento em que
                    o cron leu a mensagem, não quando ela foi enviada. */}
                <strong>
                  {fmtDateTime(msgs[0]?.sentAt ?? thread.createdAt)}
                </strong>
              </div>
              <div className="prop-row">
                <span>Última msg</span>
                <strong>{fmtRelative(thread.lastMessageAt)}</strong>
              </div>
            </div>

            <div className="card props">
              <span className="card-title">Contato</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="avatar lg plain">{initials(thread.customerAddr)}</div>
                <div className="agent-name">
                  <strong>{thread.customerAddr ?? "—"}</strong>
                </div>
              </div>

              <UnsubscribeButton
                threadId={threadId}
                contact={thread.customerAddr}
                projectLinked={Boolean(mailbox?.everinboxProjectIds?.trim())}
              />
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
