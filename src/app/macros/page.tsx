import { db } from "@/db";
import { macros } from "@/db/schema";
import AppShell from "@/app/_components/AppShell";
import { createMacroAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function MacrosPage() {
  const list = await db.select().from(macros).orderBy(macros.title);

  return (
    <AppShell>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Respostas prontas</h1>
            <p className="page-sub">
              {list.length} macro{list.length === 1 ? "" : "s"} disponíve
              {list.length === 1 ? "l" : "is"} para o time no atendimento.
            </p>
          </div>
        </div>

        <div className="macro-grid">
          <div className="card">
            <div className="card-head">Macros do time</div>
            {list.length === 0 ? (
              <div className="empty">Nenhuma macro cadastrada.</div>
            ) : (
              list.map((m) => (
                <div key={m.id} className="macro-item">
                  <div className="head">
                    <strong>{m.title}</strong>
                    {m.shortcut && <span className="pill mono">{m.shortcut}</span>}
                  </div>
                  <div className="body">{m.body}</div>
                </div>
              ))
            )}
          </div>

          <div className="card props">
            <span className="card-title">Nova macro</span>
            <form action={createMacroAction}>
              <div className="field">
                <label htmlFor="title">Título</label>
                <input id="title" name="title" required />
              </div>
              <div className="field">
                <label htmlFor="shortcut">Atalho (opcional)</label>
                <input id="shortcut" name="shortcut" placeholder="/ola" />
              </div>
              <div className="field">
                <label htmlFor="body">Corpo</label>
                <textarea id="body" name="body" required style={{ minHeight: 140 }} />
              </div>
              <button type="submit" className="primary" style={{ width: "100%" }}>
                Criar macro
              </button>
            </form>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
