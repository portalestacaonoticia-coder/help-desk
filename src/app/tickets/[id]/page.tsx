import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { threads, mailboxes, messages, users, macros } from "@/db/schema";
import Topbar from "@/app/_components/Topbar";
import ReplyBox from "@/app/_components/ReplyBox";
import { assignAction, setStatusAction } from "@/app/actions";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  novo: "Novo",
  em_andamento: "Em andamento",
  aguardando_cliente: "Aguardando cliente",
  resolvido: "Resolvido",
};

function fmtDate(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("pt-BR");
}

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

  return (
    <>
      <Topbar />
      <div className="container">
        <div style={{ marginBottom: 12 }}>
          <Link href="/tickets">← Voltar</Link>
        </div>
        <h2 style={{ margin: "0 0 4px" }}>{thread.subject || "(sem assunto)"}</h2>
        <div className="muted" style={{ marginBottom: 16 }}>
          <span className="badge mailbox">{mailbox?.label}</span>{" "}
          {thread.customerAddr} · {msgs.length} mensagem(ns)
        </div>

        <div className="thread-grid">
          <div>
            <div className="panel">
              {msgs.map((m) => (
                <div key={m.id} className={`msg ${m.direction}`}>
                  <div className="msg-head">
                    <span className="msg-from">
                      {m.direction === "outbound" ? "→ " : ""}
                      {m.fromAddr}
                    </span>
                    <span>{fmtDate(m.sentAt ?? m.createdAt)}</span>
                  </div>
                  <div className="msg-body">
                    {m.bodyText || "(sem corpo de texto)"}
                  </div>
                </div>
              ))}
            </div>

            <ReplyBox threadId={threadId} macros={macroList} />
          </div>

          <div>
            <div className="panel sidebar-box">
              <h3>Status</h3>
              <form action={setStatusAction} className="field-row">
                <input type="hidden" name="threadId" value={threadId} />
                <select name="status" defaultValue={thread.status}>
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
            </div>

            <div className="panel sidebar-box">
              <h3>Atribuição</h3>
              <form action={assignAction} className="field-row">
                <input type="hidden" name="threadId" value={threadId} />
                <select name="agentId" defaultValue={thread.assignedAgentId ?? ""}>
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
            </div>

            <div className="panel sidebar-box">
              <h3>Detalhes</h3>
              <div className="muted" style={{ fontSize: 13 }}>
                <div>Categoria: {thread.category ?? "—"}</div>
                <div>Criado: {fmtDate(thread.createdAt)}</div>
                <div>Última msg: {fmtDate(thread.lastMessageAt)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
