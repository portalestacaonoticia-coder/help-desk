import { eq, asc, sql } from "drizzle-orm";
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

  // Uma entrada de menu por operação (caixa ativa), com sua fila em aberto.
  const operations = await db
    .select({
      id: mailboxes.id,
      name: sql<string>`coalesce(nullif(${mailboxes.operation}, ''), ${mailboxes.label})`,
      openCount: sql<number>`(
        select count(*)::int from ${threads}
        where ${threads.mailboxId} = ${mailboxes.id}
          and ${threads.status} = 'aberto'
      )`,
    })
    .from(mailboxes)
    .where(eq(mailboxes.active, true))
    .orderBy(asc(mailboxes.label));

  return (
    <div className="shell">
      <Sidebar
        openCount={openCount}
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
