"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveMacroAction } from "@/app/actions";

export type MacroLite = {
  id: number;
  title: string;
  body: string;
  shortcut: string | null;
};

function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="primary"
      disabled={pending}
      style={{ width: "100%" }}
    >
      {pending ? "Salvando…" : editing ? "Salvar alterações" : "Criar"}
    </button>
  );
}

export default function MacroManager({ macros }: { macros: MacroLite[] }) {
  const [editing, setEditing] = useState<MacroLite | null>(null);
  // Trocar a key remonta o form, para os defaultValue acompanharem a seleção.
  const formKey = editing?.id ?? "nova";

  return (
    <div className="macro-grid">
      <div className="card">
        {macros.length === 0 ? (
          <div className="empty">Nenhuma resposta pronta cadastrada.</div>
        ) : (
          macros.map((m) => (
            <div
              key={m.id}
              className={`macro-item${editing?.id === m.id ? " selected" : ""}`}
            >
              <div className="head">
                <strong>{m.title}</strong>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {m.shortcut && <span className="pill mono">{m.shortcut}</span>}
                  <button type="button" onClick={() => setEditing(m)}>
                    Editar
                  </button>
                </span>
              </div>
              <div className="body">{m.body}</div>
            </div>
          ))
        )}
      </div>

      <div className="card props">
        <span className="card-title">
          {editing ? `Editando ${editing.title}` : "Nova resposta pronta"}
        </span>

        <form key={formKey} action={saveMacroAction}>
          {editing && <input type="hidden" name="id" value={editing.id} />}

          <div className="field">
            <label htmlFor="title">Título</label>
            <input
              id="title"
              name="title"
              required
              defaultValue={editing?.title ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="shortcut">Atalho (opcional)</label>
            <input
              id="shortcut"
              name="shortcut"
              placeholder="/ola"
              defaultValue={editing?.shortcut ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="body">Corpo</label>
            <textarea
              id="body"
              name="body"
              required
              style={{ minHeight: 140 }}
              defaultValue={editing?.body ?? ""}
            />
          </div>

          <SaveButton editing={Boolean(editing)} />
        </form>

        {editing && (
          <button
            type="button"
            onClick={() => setEditing(null)}
            style={{ width: "100%", marginTop: 8 }}
          >
            Cancelar edição
          </button>
        )}
      </div>
    </div>
  );
}
