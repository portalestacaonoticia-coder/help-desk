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

  // Último log de ingestão por caixa, via subquery correlacionada.
  const rows = await db
    .select({
      id: mailboxes.id,
      label: mailboxes.label,
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
      threadCount: sql<number>`(
        select count(*)::int from ${threads}
        where ${threads.mailboxId} = ${mailboxes.id}
      )`,
      lastIngestAt: sql<Date | null>`(
        select ${ingestLogs.createdAt} from ${ingestLogs}
        where ${ingestLogs.mailboxId} = ${mailboxes.id}
        order by ${ingestLogs.createdAt} desc limit 1
      )`,
      lastIngestStatus: sql<string | null>`(
        select ${ingestLogs.status} from ${ingestLogs}
        where ${ingestLogs.mailboxId} = ${mailboxes.id}
        order by ${ingestLogs.createdAt} desc limit 1
      )`,
      lastIngestMessage: sql<string | null>`(
        select ${ingestLogs.message} from ${ingestLogs}
        where ${ingestLogs.mailboxId} = ${mailboxes.id}
        order by ${ingestLogs.createdAt} desc limit 1
      )`,
    })
    .from(mailboxes)
    .orderBy(asc(mailboxes.label));

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
