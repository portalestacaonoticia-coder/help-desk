import Link from "next/link";
import { and, eq, ilike, or, ne, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { threads, mailboxes, users, messages } from "@/db/schema";
import AppShell from "@/app/_components/AppShell";
import {
  STATUS_LABELS,
  colorClass,
  fmtRelative,
  initials,
} from "@/lib/ui";

export const dynamic = "force-dynamic";

type SP = { mailbox?: string; status?: string; q?: string };

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
      category: threads.category,
      lastMessageAt: threads.lastMessageAt,
      mailboxId: threads.mailboxId,
      mailboxLabel: mailboxes.label,
      agentId: users.id,
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

  const [{ n: openTotal }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(threads)
    .where(ne(threads.status, "resolvido"));

  function chipHref(next: Partial<SP>) {
    const params = new URLSearchParams();
    const merged = { mailbox: sp.mailbox, status: sp.status, q: sp.q, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/tickets?${qs}` : "/tickets";
  }

  return (
    <AppShell query={sp.q}>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Fila de chamados</h1>
            <p className="page-sub">
              {openTotal} chamado{openTotal === 1 ? "" : "s"} em aberto no
              ecossistema Tihee.
            </p>
          </div>
        </div>

        <form className="filters" method="get">
          {sp.q ? <input type="hidden" name="q" value={sp.q} /> : null}
          <div>
            <label htmlFor="f-mailbox">Caixa</label>
            <select id="f-mailbox" name="mailbox" defaultValue={sp.mailbox ?? ""}>
              <option value="">Todas</option>
              {mbList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ""}>
              <option value="">Todos</option>
              {Object.entries(STATUS_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                  {countByStatus.has(v) ? ` (${countByStatus.get(v)})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <button type="submit" className="primary">
              Filtrar
            </button>
          </div>
        </form>

        <div className="chips">
          <Link href={chipHref({ status: undefined })} className={`chip${!status ? " active" : ""}`}>
            Todos
          </Link>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <Link
              key={v}
              href={chipHref({ status: v })}
              className={`chip${status === v ? " active" : ""}`}
            >
              {l}
              {countByStatus.has(v) ? ` · ${countByStatus.get(v)}` : ""}
            </Link>
          ))}
        </div>

        <div className="card table">
          <div className="trow thead">
            <div>ID</div>
            <div>Assunto</div>
            <div>Caixa</div>
            <div className="col-hide">Categoria</div>
            <div className="col-hide">Responsável</div>
            <div>Status</div>
          </div>

          {rows.length === 0 ? (
            <div className="empty">
              Nenhum chamado encontrado. Assim que a ingestão IMAP rodar, os
              e-mails aparecem aqui.
            </div>
          ) : (
            rows.map((t) => (
              <Link key={t.id} href={`/tickets/${t.id}`} className="trow">
                <div className="mono t-meta">#{t.id}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="t-subject">{t.subject || "(sem assunto)"}</div>
                  <div className="t-preview">
                    {t.customerAddr ? `${t.customerAddr} · ` : ""}
                    {fmtRelative(t.lastMessageAt)}
                    {previews.get(t.id) ? ` · ${previews.get(t.id)}` : ""}
                  </div>
                </div>
                <div>
                  <span className={`tag ${colorClass(t.mailboxId)}`}>
                    {t.mailboxLabel}
                  </span>
                </div>
                <div className="col-hide">
                  {t.category ? <span className="pill">{t.category}</span> : <span className="t-meta">—</span>}
                </div>
                <div className="assignee col-hide">
                  {t.agentName ? (
                    <>
                      <div className={`avatar ${colorClass(t.agentId)}`}>
                        {initials(t.agentName)}
                      </div>
                      <span>{t.agentName.split(" ")[0]}</span>
                    </>
                  ) : (
                    <>
                      <div className="avatar plain">—</div>
                      <span className="t-meta">A definir</span>
                    </>
                  )}
                </div>
                <div>
                  <span className={`badge st-${t.status}`}>
                    {STATUS_LABELS[t.status] ?? t.status}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}
