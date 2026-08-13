import Link from "next/link";
import { and, eq, ilike, or, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { threads, mailboxes, messages } from "@/db/schema";
import AppShell from "@/app/_components/AppShell";
import TicketTable from "./_components/TicketTable";
import PerPageSelect from "./_components/PerPageSelect";
import { auth } from "@/lib/auth";
import { STATUS_LABELS } from "@/lib/ui";

export const dynamic = "force-dynamic";

type SP = {
  mailbox?: string;
  status?: string;
  q?: string;
  page?: string;
  per?: string;
};

const PER_OPTIONS = [10, 50, 100];
const DEFAULT_PER = 50;

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  // Remoção é destrutiva e sem desfazer: só administrador.
  const session = await auth();
  const canDelete = session?.user?.role === "admin";

  const mailboxId = sp.mailbox ? Number(sp.mailbox) : null;
  const status = sp.status || null;
  const q = sp.q?.trim() || null;

  const perRaw = Number(sp.per);
  const perPage = PER_OPTIONS.includes(perRaw) ? perRaw : DEFAULT_PER;
  const pageRaw = Number(sp.page);
  const requestedPage =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const conditions = [];
  if (mailboxId) conditions.push(eq(threads.mailboxId, mailboxId));
  if (status) conditions.push(eq(threads.status, status));
  if (q) {
    const like = `%${q}%`;
    conditions.push(
      or(
        ilike(threads.subject, like),
        ilike(threads.customerAddr, like),
        // Corpo do e-mail. EXISTS em vez de join: uma thread com 10 mensagens
        // casando não pode aparecer 10 vezes na fila nem inflar o total.
        sql`exists (
          select 1 from ${messages} m
          where m.thread_id = ${threads.id}
            and m.body_text ilike ${like}
        )`,
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [{ n: total }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(threads)
    .innerJoin(mailboxes, eq(mailboxes.id, threads.mailboxId))
    .where(where);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * perPage;

  const rows = await db
    .select({
      id: threads.id,
      subject: threads.subject,
      customerAddr: threads.customerAddr,
      status: threads.status,
      category: threads.category,
      lastMessageAt: threads.lastMessageAt,
      mailboxId: threads.mailboxId,
      mailboxLabel: sql<string>`coalesce(nullif(${mailboxes.operation}, ''), ${mailboxes.label})`,
    })
    .from(threads)
    .innerJoin(mailboxes, eq(mailboxes.id, threads.mailboxId))
    .where(where)
    .orderBy(desc(threads.lastMessageAt))
    .limit(perPage)
    .offset(offset);

  // Prévia da última mensagem por thread (DISTINCT ON é eficiente no Postgres).
  // A direção vem junto: sem ela, a nossa própria resposta aparecia na fila
  // como se fosse a fala do cliente.
  const ids = rows.map((r) => r.id);
  const previews = new Map<
    number,
    { text: string; outbound: boolean; porIa: boolean }
  >();
  if (ids.length > 0) {
    const prevRows = await db.execute<{
      thread_id: number;
      body_text: string | null;
      direction: string;
      sent_by_user_id: number | null;
    }>(
      sql`select distinct on (thread_id) thread_id, body_text, direction,
                 sent_by_user_id
          from ${messages}
          where thread_id in ${ids}
          order by thread_id, created_at desc`,
    );
    for (const r of prevRows) {
      const outbound = r.direction === "outbound";
      previews.set(Number(r.thread_id), {
        text: (r.body_text ?? "").replace(/\s+/g, " ").trim(),
        outbound,
        // sent_by_user_id nulo em outbound = quem mandou foi a IA. É a mesma
        // convenção que sendReply usa ao gravar o envio automático.
        porIa: outbound && r.sent_by_user_id === null,
      });
    }
  }

  const mbList = await db
    .select({
      id: mailboxes.id,
      label: mailboxes.label,
      operation: mailboxes.operation,
    })
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
    .where(eq(threads.status, "aberto"));

  function hrefWith(next: Partial<SP>) {
    const params = new URLSearchParams();
    const merged: SP = {
      mailbox: sp.mailbox,
      status: sp.status,
      q: sp.q,
      per: perPage === DEFAULT_PER ? undefined : String(perPage),
      ...next,
    };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/tickets?${qs}` : "/tickets";
  }

  // Trocar de filtro volta para a primeira página.
  const chipHref = (next: Partial<SP>) => hrefWith({ ...next, page: undefined });
  const pageHref = (p: number) => hrefWith({ page: p === 1 ? undefined : String(p) });

  // Janela de páginas ao redor da atual (com "…" nas pontas).
  const pageWindow: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(totalPages, page + 2); p++) {
    pageWindow.push(p);
  }

  const firstItem = total === 0 ? 0 : offset + 1;
  const lastItem = offset + rows.length;

  return (
    <AppShell query={sp.q} mailbox={sp.mailbox}>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Fila de respostas</h1>
            <p className="page-sub">
              {openTotal} resposta{openTotal === 1 ? "" : "s"} em aberto no
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
                  {m.operation || m.label}
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
          {/* `per` viaja escondido: o controle dele fica no paginador. */}
          <input type="hidden" name="per" value={String(perPage)} />
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

        <TicketTable
          canDelete={canDelete}
          rows={rows.map((t) => ({
            ...t,
            preview: previews.get(t.id)?.text ?? "",
            answered: previews.get(t.id)?.outbound ?? false,
            answeredByAi: previews.get(t.id)?.porIa ?? false,
          }))}
        />

        <div className="pager">
          <div className="pager-info">
            {total === 0
              ? "Nenhum resultado"
              : `Mostrando ${firstItem}–${lastItem} de ${total}`}
          </div>

          <PerPageSelect
            options={PER_OPTIONS}
            value={perPage}
            hrefFor={Object.fromEntries(
              PER_OPTIONS.map((n) => [
                n,
                hrefWith({
                  per: n === DEFAULT_PER ? undefined : String(n),
                  page: undefined,
                }),
              ]),
            )}
          />

          <div className="pager-nav">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="chip">
                ← Anterior
              </Link>
            ) : (
              <span className="chip disabled">← Anterior</span>
            )}

            {pageWindow[0] > 1 ? (
              <>
                <Link href={pageHref(1)} className="chip">
                  1
                </Link>
                {pageWindow[0] > 2 ? <span className="pager-gap">…</span> : null}
              </>
            ) : null}

            {pageWindow.map((p) => (
              <Link
                key={p}
                href={pageHref(p)}
                className={`chip${p === page ? " active" : ""}`}
              >
                {p}
              </Link>
            ))}

            {pageWindow[pageWindow.length - 1] < totalPages ? (
              <>
                {pageWindow[pageWindow.length - 1] < totalPages - 1 ? (
                  <span className="pager-gap">…</span>
                ) : null}
                <Link href={pageHref(totalPages)} className="chip">
                  {totalPages}
                </Link>
              </>
            ) : null}

            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="chip">
                Próxima →
              </Link>
            ) : (
              <span className="chip disabled">Próxima →</span>
            )}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
