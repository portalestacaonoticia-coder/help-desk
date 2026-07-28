import { and, eq, asc, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { threads, mailboxes } from "@/db/schema";
import { initials } from "@/lib/ui";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default async function AppShell({
  query,
  mailbox,
  children,
}: {
  query?: string;
  /** Caixa selecionada na tela atual — destaca a operação no menu. */
  mailbox?: string;
  children: React.ReactNode;
}) {
  const session = await auth();
  const name = session?.user?.name ?? session?.user?.email ?? "Agente";
  const role = session?.user?.role === "admin" ? "Administrador" : "Agente";

  const [{ n: openCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(threads)
    .where(eq(threads.status, "aberto"));

  // Respostas criadas hoje. O corte é a meia-noite de São Paulo, não do UTC
  // em que o servidor roda — senão o "dia" vira às 21h.
  const [{ n: todayCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(threads)
    .where(
      sql`${threads.createdAt} >= (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo'`,
    );

  // Uma entrada de menu por operação (caixa ativa), com sua fila em aberto.
  //
  // Correlação por leftJoin, não por subquery em template `sql`: dentro do
  // template o drizzle renderiza a coluna sem o prefixo da tabela, e
  // `${threads.mailboxId} = ${mailboxes.id}` viraria `"mailbox_id" = "id"` —
  // ambos resolvidos contra `threads`. Os helpers (eq/and) qualificam certo.
  const operations = await db
    .select({
      id: mailboxes.id,
      name: sql<string>`coalesce(nullif(${mailboxes.operation}, ''), ${mailboxes.label})`,
      openCount: sql<number>`count(${threads.id})::int`,
    })
    .from(mailboxes)
    .leftJoin(
      threads,
      and(eq(threads.mailboxId, mailboxes.id), eq(threads.status, "aberto")),
    )
    .where(eq(mailboxes.active, true))
    .groupBy(mailboxes.id, mailboxes.operation, mailboxes.label)
    .orderBy(asc(mailboxes.label));

  return (
    <div className="shell">
      <Sidebar
        openCount={openCount}
        todayCount={todayCount}
        operations={operations}
        activeMailbox={mailbox ?? null}
        agentName={name}
        agentInitials={initials(name)}
        agentRole={role}
      />
      <div className="main">
        <Topbar query={query} />
        {children}
      </div>
    </div>
  );
}
