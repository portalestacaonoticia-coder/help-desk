import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { mailboxes, threads, ingestLogs } from "@/db/schema";
import { auth } from "@/lib/auth";
import AppShell from "@/app/_components/AppShell";
import { fmtRelative } from "@/lib/ui";
import MailboxManager from "./_components/MailboxManager";

export const dynamic = "force-dynamic";

export default async function MailboxesPage() {
  const session = await auth();
  const canEdit = session?.user?.role === "admin";

  // Correlação NÃO pode sair de subquery em template `sql`: ali o drizzle
  // renderiza a coluna sem o prefixo da tabela, então `${x.mailboxId} =
  // ${mailboxes.id}` vira `"mailbox_id" = "id"` e os dois resolvem contra a
  // tabela de dentro. Por isso cada agregação vem na sua própria query.
  const boxes = await db
    .select({
      id: mailboxes.id,
      label: mailboxes.label,
      operation: mailboxes.operation,
      imapHost: mailboxes.imapHost,
      imapPort: mailboxes.imapPort,
      imapUser: mailboxes.imapUser,
      imapTls: mailboxes.imapTls,
      smtpHost: mailboxes.smtpHost,
      smtpPort: mailboxes.smtpPort,
      smtpUser: mailboxes.smtpUser,
      smtpTls: mailboxes.smtpTls,
      fromAddress: mailboxes.fromAddress,
      active: mailboxes.active,
      lastUid: mailboxes.lastUid,
    })
    .from(mailboxes)
    .orderBy(asc(mailboxes.label));

  const counts = await db
    .select({ mailboxId: threads.mailboxId, n: sql<number>`count(*)::int` })
    .from(threads)
    .groupBy(threads.mailboxId);
  const countByMailbox = new Map(counts.map((c) => [c.mailboxId, c.n]));

  // Último log por caixa (DISTINCT ON é eficiente no Postgres).
  const logRows = await db.execute<{
    mailbox_id: number;
    status: string;
    message: string | null;
    created_at: string;
  }>(
    sql`select distinct on (mailbox_id) mailbox_id, status, message, created_at
        from ${ingestLogs}
        where mailbox_id is not null
        order by mailbox_id, created_at desc`,
  );
  const logByMailbox = new Map(
    [...logRows].map((r) => [Number(r.mailbox_id), r]),
  );

  const rows = boxes.map((b) => {
    const log = logByMailbox.get(b.id);
    return {
      ...b,
      threadCount: countByMailbox.get(b.id) ?? 0,
      lastIngestAt: log ? new Date(log.created_at) : null,
      lastIngestStatus: log?.status ?? null,
      lastIngestMessage: log?.message ?? null,
    };
  });

  const failing = rows.filter((r) => r.lastIngestStatus === "error");
  // Ordena por tempo de verdade: o sort padrão compara datas como string.
  const lastRun = rows
    .map((r) => (r.lastIngestAt ? new Date(r.lastIngestAt) : null))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())
    .pop();

  return (
    <AppShell>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Caixas de e-mail</h1>
            <p className="page-sub">
              {rows.length} caixa{rows.length === 1 ? "" : "s"} cadastrada
              {rows.length === 1 ? "" : "s"}. A ingestão roda a cada 2 minutos
              pelo cron
              {lastRun ? ` — última execução ${fmtRelative(lastRun)}.` : "."}
            </p>
          </div>
        </div>

        {failing.length > 0 && (
          <div className="callout danger">
            <strong>
              {failing.length} caixa{failing.length === 1 ? "" : "s"} com falha na
              última ingestão:
            </strong>{" "}
            {failing.map((f) => f.label).join(", ")}. E-mails novos dessas caixas
            não estão entrando.
          </div>
        )}

        {!canEdit && (
          <div className="callout warn">
            Só administradores podem cadastrar ou editar caixas. Você está vendo
            o monitoramento.
          </div>
        )}

        <MailboxManager mailboxes={rows} canEdit={canEdit} />
      </section>
    </AppShell>
  );
}
