"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteMacroAction, saveMacroAction } from "@/app/actions";

export type MacroLite = {
  id: number;
  title: string;
  body: string;
  shortcut: string | null;
  mailboxId: number | null;
  mailboxName: string | null;
};

export type MailboxOption = { id: number; nome: string };

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

export default function MacroManager({
  macros,
  mailboxes,
  defaultMailboxId,
}: {
  macros: MacroLite[];
  mailboxes: MailboxOption[];
  defaultMailboxId: number | null;
}) {
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
                  {/* Sem caixa = legado, que não aparece no atendimento. */}
                  <span className="pill">{m.mailboxName ?? "Sem caixa"}</span>
                  {m.shortcut && <span className="pill mono">{m.shortcut}</span>}
                  <button type="button" onClick={() => setEditing(m)}>
                    Editar
                  </button>
                  <form
                    action={deleteMacroAction}
                    onSubmit={(e) => {
                      if (
                        !confirm(
                          `Remover a resposta "${m.title}"?\n\nNão dá para desfazer.`,
                        )
                      ) {
                        e.preventDefault();
                        return;
                      }
                      // O form de edição some junto, senão fica apontando
                      // para um registro que não existe mais.
                      if (editing?.id === m.id) setEditing(null);
                    }}
                  >
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit">Remover</button>
                  </form>
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
            <label htmlFor="mailboxId">Caixa de entrada</label>
            <select
              id="mailboxId"
              name="mailboxId"
              required
              defaultValue={
                editing?.mailboxId ?? defaultMailboxId ?? ""
              }
            >
              <option value="">Selecione a caixa</option>
              {mailboxes.map((mb) => (
                <option key={mb.id} value={mb.id}>
                  {mb.nome}
                </option>
              ))}
            </select>
            <span className="hint">
              A resposta só aparece no atendimento dessa caixa.
            </span>
          </div>
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
