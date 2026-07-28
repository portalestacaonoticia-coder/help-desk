import { db } from "@/db";
import { macros } from "@/db/schema";
import AppShell from "@/app/_components/AppShell";
import MacroManager from "./_components/MacroManager";

export const dynamic = "force-dynamic";

export default async function MacrosPage() {
  const list = await db
    .select({
      id: macros.id,
      title: macros.title,
      body: macros.body,
      shortcut: macros.shortcut,
    })
    .from(macros)
    .orderBy(macros.title);

  return (
    <AppShell>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Respostas prontas</h1>
            <p className="page-sub">
              {list.length} resposta{list.length === 1 ? "" : "s"} pronta
              {list.length === 1 ? "" : "s"} disponíve
              {list.length === 1 ? "l" : "is"} para o time no atendimento.
            </p>
          </div>
        </div>

        <MacroManager macros={list} />
      </section>
    </AppShell>
  );
}
