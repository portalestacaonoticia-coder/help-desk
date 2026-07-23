import Link from "next/link";
import { and, eq, ilike, or, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { threads, mailboxes, users, messages } from "@/db/schema";
import Topbar from "@/app/_components/Topbar";

export const dynamic = "force-dynamic";

type SP = { mailbox?: string; status?: string; q?: string };

const STATUS_LABELS: Record<string, string> = {
  novo: "Novo",
  em_andamento: "Em andamento",
  aguardando_cliente: "Aguardando cliente",
  resolvido: "Resolvido",
};

function fmtDate(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const mailboxId = sp.mailbox ? Number(sp.mailbox) : null;
  const status = sp.status || null;
  const q = sp.q?.trim() || null;

  const conditions = [];
  if (mailboxId) conditions.push(eq(threads.mailboxId, mailboxId));
  if (status) conditions.push(eq(threads.status, status));
  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(ilike(threads.subject, like), ilike(threads.customerAddr, like))!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: threads.id,
      subject: threads.subject,
      customerAddr: threads.customerAddr,
      status: threads.status,
      lastMessageAt: threads.lastMessageAt,
      mailboxLabel: mailboxes.label,
      agentName: users.name,
    })
    .from(threads)
    .innerJoin(mailboxes, eq(mailboxes.id, threads.mailboxId))
    .leftJoin(users, eq(users.id, threads.assignedAgentId))
    .where(where)
    .orderBy(desc(threads.lastMessageAt))
    .limit(100);

  // Prévia da última mensagem por thread (DISTINCT ON é eficiente no Postgres).
  const ids = rows.map((r) => r.id);
  const previews = new Map<number, string>();
  if (ids.length > 0) {
    const prevRows = await db.execute<{ thread_id: number; body_text: string | null }>(
      sql`select distinct on (thread_id) thread_id, body_text
          from ${messages}
          where thread_id in ${ids}
          order by thread_id, created_at desc`,
    );
    for (const r of prevRows) {
      previews.set(Number(r.thread_id), (r.body_text ?? "").replace(/\s+/g, " ").trim());
    }
  }

  const mbList = await db
    .select({ id: mailboxes.id, label: mailboxes.label })
    .from(mailboxes)
    .orderBy(mailboxes.label);

  // Contagem por status para os "chips" de filtro rápido.
  const statusCounts = await db
    .select({ status: threads.status, n: sql<number>`count(*)::int` })
    .from(threads)
    .where(mailboxId ? eq(threads.mailboxId, mailboxId) : undefined)
    .groupBy(threads.status);
  const countByStatus = new Map(statusCounts.map((s) => [s.status, s.n]));

  return (
    <>
      <Topbar />
      <div className="container">
        <form className="filters" method="get">
          <div>
            <label>Caixa</label>
            <select name="mailbox" defaultValue={sp.mailbox ?? ""}>
              <option value="">Todas</option>
              {mbList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Status</label>
            <select name="status" defaultValue={sp.status ?? ""}>
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                  {countByStatus.has(v) ? ` (${countByStatus.get(v)})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grow">
            <label>Busca (assunto ou e-mail)</label>
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar…" />
          </div>
          <div>
            <button type="submit" className="primary">
              Filtrar
            </button>
          </div>
        </form>

        <div className="panel">
          {rows.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center" }} className="muted">
              Nenhum ticket encontrado. Assim que a ingestão IMAP rodar, os
              e-mails aparecem aqui.
            </div>
          ) : (
            <ul className="ticket-list">
              {rows.map((t) => (
                <li key={t.id} className="ticket-row">
                  <div>
                    <span className={`badge ${t.status}`}>
                      {STATUS_LABELS[t.status] ?? t.status}
                    </span>
                  </div>
                  <div style={{ overflow: "hidden" }}>
                    <div className="ticket-subject">
                      <Link href={`/tickets/${t.id}`}>
                        {t.subject || "(sem assunto)"}
                      </Link>
                    </div>
                    <div className="ticket-preview">
                      {previews.get(t.id) || t.customerAddr || ""}
                    </div>
                  </div>
                  <div className="ticket-meta">
                    <span className="badge mailbox">{t.mailboxLabel}</span>
                    <div style={{ marginTop: 4 }}>
                      {t.agentName ? `→ ${t.agentName}` : "não atribuído"}
                    </div>
                  </div>
                  <div className="ticket-meta" style={{ textAlign: "right" }}>
                    {t.customerAddr}
                    <div>{fmtDate(t.lastMessageAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
