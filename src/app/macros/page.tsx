import { db } from "@/db";
import { macros } from "@/db/schema";
import Topbar from "@/app/_components/Topbar";
import { createMacroAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function MacrosPage() {
  const list = await db.select().from(macros).orderBy(macros.title);

  return (
    <>
      <Topbar />
      <div className="container">
        <h2 style={{ marginTop: 0 }}>Macros / Respostas prontas</h2>

        <div className="thread-grid">
          <div className="panel">
            {list.length === 0 ? (
              <div style={{ padding: 24 }} className="muted">
                Nenhuma macro cadastrada.
              </div>
            ) : (
              list.map((m) => (
                <div key={m.id} className="msg">
                  <div className="msg-head">
                    <span className="msg-from">{m.title}</span>
                    {m.shortcut && <span className="badge mailbox">{m.shortcut}</span>}
                  </div>
                  <div className="msg-body">{m.body}</div>
                </div>
              ))
            )}
          </div>

          <div className="panel sidebar-box">
            <h3>Nova macro</h3>
            <form action={createMacroAction}>
              <div className="field-row">
                <label>Título</label>
                <input name="title" required />
              </div>
              <div className="field-row">
                <label>Atalho (opcional)</label>
                <input name="shortcut" placeholder="/ola" />
              </div>
              <div className="field-row">
                <label>Corpo</label>
                <textarea name="body" required style={{ minHeight: 120 }} />
              </div>
              <button type="submit" className="primary" style={{ width: "100%" }}>
                Criar macro
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
