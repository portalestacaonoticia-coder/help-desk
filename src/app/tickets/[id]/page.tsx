import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { threads, mailboxes, messages, users, macros } from "@/db/schema";
import AppShell from "@/app/_components/AppShell";
import ReplyBox from "@/app/_components/ReplyBox";
import { assignAction, setStatusAction } from "@/app/actions";
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

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt));

  const agents = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.active, true));

  const macroList = await db
    .select({
      id: macros.id,
      title: macros.title,
      body: macros.body,
      shortcut: macros.shortcut,
    })
    .from(macros)
    .orderBy(macros.title);

  const assignee = agents.find((a) => a.id === thread.assignedAgentId);

  return (
    <AppShell>
      <section className="page">
        <div>
          <div className="breadcrumb">
            <Link href="/tickets">Chamados</Link>
            <span>/</span>
            <span className="mono">#{thread.id}</span>
          </div>
          <h1 style={{ fontSize: 26 }}>{thread.subject || "(sem assunto)"}</h1>
          <div className="chips" style={{ marginTop: 12 }}>
            <span className={`tag ${colorClass(thread.mailboxId)}`}>
              {mailbox?.label}
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

            <ReplyBox threadId={threadId} macros={macroList} />
          </div>

          <div className="thread-aside">
            <div className="card props">
              <span className="card-title">Propriedades</span>

              <form action={setStatusAction}>
                <input type="hidden" name="threadId" value={threadId} />
                <label htmlFor="status">Status</label>
                <select id="status" name="status" defaultValue={thread.status}>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <button type="submit" style={{ marginTop: 8, width: "100%" }}>
                  Atualizar status
                </button>
              </form>

              <form action={assignAction}>
                <input type="hidden" name="threadId" value={threadId} />
                <label htmlFor="agentId">Responsável</label>
                <select
                  id="agentId"
                  name="agentId"
                  defaultValue={thread.assignedAgentId ?? ""}
                >
                  <option value="">Não atribuído</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <button type="submit" style={{ marginTop: 8, width: "100%" }}>
                  Atribuir
                </button>
              </form>

              <div className="hr" />

              <div className="prop-row">
                <span>Caixa</span>
                <span className={`tag ${colorClass(thread.mailboxId)}`}>
                  {mailbox?.label}
                </span>
              </div>
              <div className="prop-row">
                <span>Categoria</span>
                <strong>{thread.category ?? "—"}</strong>
              </div>
              <div className="prop-row">
                <span>Criado</span>
                <strong>{fmtDateTime(thread.createdAt)}</strong>
              </div>
              <div className="prop-row">
                <span>Última msg</span>
                <strong>{fmtRelative(thread.lastMessageAt)}</strong>
              </div>
            </div>

            <div className="card props">
              <span className="card-title">Solicitante</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="avatar lg plain">{initials(thread.customerAddr)}</div>
                <div className="agent-name">
                  <strong>{thread.customerAddr ?? "—"}</strong>
                  <span>{assignee ? `Atendido por ${assignee.name}` : "Sem responsável"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
