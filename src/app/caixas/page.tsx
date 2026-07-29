import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { mailboxes, threads, messages, ingestLogs } from "@/db/schema";
import { auth } from "@/lib/auth";
import AppShell from "@/app/_components/AppShell";
import { fmtRelative } from "@/lib/ui";
import MailboxManager from "./_components/MailboxManager";
import CleanupPanel from "./_components/CleanupPanel";
import { listProjects } from "@/lib/everinbox";

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
      signature: mailboxes.signature,
      siteUrl: mailboxes.siteUrl,
      everinboxProjectIds: mailboxes.everinboxProjectIds,
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
  const totalThreads = counts.reduce((s, c) => s + c.n, 0);

  // Projetos da Everinbox para o seletor. Devolve vazio se a API falhar — a
  // tela cai para campo de texto em vez de quebrar.
  const { projects, error: projectsError } = canEdit
    ? await listProjects()
    : { projects: [], error: undefined };

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

  // Sinal de saúde = a última mensagem que ENTROU de fato, não o status do
  // log. Uma rodada pode morrer no meio (timeout, socket caído) depois de já
  // ter gravado dezenas de e-mails: o log fica 'error', mas a caixa está
  // funcionando. Só `messages` responde "entrou e-mail?" sem intermediário.
  const entryRows = await db
    .select({
      mailboxId: messages.mailboxId,
      lastAt: sql<string>`max(${messages.createdAt})`,
    })
    .from(messages)
    .groupBy(messages.mailboxId);
  const lastOkByMailbox = new Map(
    entryRows.map((r) => [r.mailboxId, new Date(r.lastAt)]),
  );

  // Sem nenhum e-mail novo nesse intervalo, a caixa está de fato parada e o
  // alarme vermelho se justifica.
  const STALL_THRESHOLD_MS = 6 * 60 * 60 * 1000;
  const now = Date.now();

  const rows = boxes.map((b) => {
    const log = logByMailbox.get(b.id);
    const lastOkAt = lastOkByMailbox.get(b.id) ?? null;
    return {
      ...b,
      threadCount: countByMailbox.get(b.id) ?? 0,
      lastIngestAt: log ? new Date(log.created_at) : null,
      lastIngestStatus: log?.status ?? null,
      lastIngestMessage: log?.message ?? null,
      lastOkAt,
      // Errou agora, mas entrou e-mail há pouco: instabilidade, não parada.
      flaky:
        log?.status === "error" &&
        lastOkAt !== null &&
        now - lastOkAt.getTime() <= STALL_THRESHOLD_MS,
    };
  });

  // Parada de verdade: última tentativa falhou e não há sucesso recente.
  const stalled = rows.filter((r) => r.lastIngestStatus === "error" && !r.flaky);
  const flaky = rows.filter((r) => r.flaky);
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

        {stalled.length > 0 && (
          <div className="callout danger">
            <strong>
              {stalled.length} caixa{stalled.length === 1 ? "" : "s"} sem
              ingestão bem-sucedida:
            </strong>{" "}
            {stalled.map((f) => f.operation || f.label).join(", ")}. E-mails
            novos dessas caixas não estão entrando.
          </div>
        )}

        {flaky.length > 0 && (
          <div className="callout warn">
            <strong>
              {flaky.length} caixa{flaky.length === 1 ? "" : "s"} com falha na
              última tentativa:
            </strong>{" "}
            {flaky.map((f) => f.operation || f.label).join(", ")}. A ingestão
            continua entrando — a última rodada caiu no meio, mas o ponteiro
            fica salvo e a próxima retoma de onde parou.
          </div>
        )}

        {!canEdit && (
          <div className="callout warn">
            Só administradores podem cadastrar ou editar caixas. Você está vendo
            o monitoramento.
          </div>
        )}

        <MailboxManager
          mailboxes={rows}
          canEdit={canEdit}
          projects={projects}
          projectsError={projectsError}
        />

        {canEdit && <CleanupPanel total={totalThreads} />}
      </section>
    </AppShell>
  );
}
