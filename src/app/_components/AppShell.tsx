import { ne, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { threads } from "@/db/schema";
import { initials } from "@/lib/ui";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default async function AppShell({
  query,
  children,
}: {
  query?: string;
  children: React.ReactNode;
}) {
  const session = await auth();
  const name = session?.user?.name ?? session?.user?.email ?? "Agente";
  const role = session?.user?.role === "admin" ? "Administrador" : "Agente";

  const [{ n: openCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(threads)
    .where(ne(threads.status, "resolvido"));

  return (
    <div className="shell">
      <Sidebar
        openCount={openCount}
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
