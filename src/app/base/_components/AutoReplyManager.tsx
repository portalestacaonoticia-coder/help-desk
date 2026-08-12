"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveAutoReplyAction, deleteAutoReplyAction } from "@/app/actions";
import { LANGUAGES, languageLabel } from "@/lib/ui";

export type AutoReplyLite = {
  id: number;
  mailboxId: number;
  mailboxName: string;
  language: string;
  body: string;
  active: boolean;
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
      {pending ? "Salvando…" : editing ? "Salvar alterações" : "Adicionar resposta"}
    </button>
  );
}

/**
 * Lista e formulário das respostas automáticas: um texto por caixa e idioma.
 *
 * Fica fora do formulário de configuração da IA de propósito — aquele salva a
 * linha única de ai_settings, este mexe em uma tabela com várias linhas, e
 * form dentro de form não é html válido.
 */
export default function AutoReplyManager({
  replies,
  mailboxes,
  isAdmin,
}: {
  replies: AutoReplyLite[];
  mailboxes: MailboxOption[];
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<AutoReplyLite | null>(null);
  const [message, formAction] = useActionState(saveAutoReplyAction, undefined);

  // Trocar a key remonta o form, para os defaultValue acompanharem a seleção.
  const formKey = editing?.id ?? "nova";

  return (
    <div className="macro-grid">
      <div className="card">
        {replies.length === 0 ? (
          <div className="empty">
            Nenhuma resposta automática cadastrada. Sem texto padrão, a IA
            redige a resposta a partir da base de conhecimento.
          </div>
        ) : (
          replies.map((r) => (
            <div
              key={r.id}
              className={`macro-item${editing?.id === r.id ? " selected" : ""}`}
            >
              <div className="head">
                <strong>{languageLabel(r.language)}</strong>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="pill">{r.mailboxName}</span>
                  {!r.active && <span className="pill">Desativada</span>}
                  {isAdmin && (
                    <>
                      <button type="button" onClick={() => setEditing(r)}>
                        Editar
                      </button>
                      <form
                        action={deleteAutoReplyAction}
                        onSubmit={(e) => {
                          if (
                            !confirm(
                              `Remover a resposta em ${languageLabel(r.language)} de ${r.mailboxName}?`,
                            )
                          ) {
                            e.preventDefault();
                          }
                        }}
                      >
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit">Remover</button>
                      </form>
                    </>
                  )}
                </span>
              </div>
              <div className="body">{r.body}</div>
            </div>
          ))
        )}
      </div>

      <div className="card props">
        <span className="card-title">
          {editing
            ? `Editando ${languageLabel(editing.language)} — ${editing.mailboxName}`
            : "Nova resposta automática"}
        </span>

        <form key={formKey} action={formAction}>
          {editing && <input type="hidden" name="id" value={editing.id} />}

          <div className="field">
            <label htmlFor="ar-language">Idioma</label>
            <select
              id="ar-language"
              name="language"
              required
              defaultValue={editing?.language ?? ""}
              disabled={!isAdmin}
            >
              <option value="">Selecione o idioma</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
            <span className="hint">
              A IA usa este texto quando o cliente escreve neste idioma.
            </span>
          </div>

          <div className="field">
            <label htmlFor="ar-mailbox">Caixa de entrada</label>
            <select
              id="ar-mailbox"
              name="mailboxId"
              required
              defaultValue={editing?.mailboxId ?? ""}
              disabled={!isAdmin}
            >
              <option value="">Selecione a caixa</option>
              {mailboxes.map((mb) => (
                <option key={mb.id} value={mb.id}>
                  {mb.nome}
                </option>
              ))}
            </select>
            <span className="hint">
              Um texto por idioma em cada caixa. As outras caixas não são
              afetadas.
            </span>
          </div>

          <div className="field">
            <label htmlFor="ar-body">Texto da resposta</label>
            <textarea
              id="ar-body"
              name="body"
              required
              style={{ minHeight: 180 }}
              placeholder="Cole aqui o texto que deve ser enviado ao cliente neste idioma."
              defaultValue={editing?.body ?? ""}
              disabled={!isAdmin}
            />
            <span className="hint">
              Vai como está: a IA não traduz nem reescreve. A assinatura da
              caixa é anexada no envio — não repita aqui.
            </span>
          </div>

          <label className="check">
            <input
              type="checkbox"
              name="active"
              defaultChecked={editing?.active ?? true}
              disabled={!isAdmin}
            />
            <span>Ativa</span>
          </label>

          {isAdmin ? (
            <SaveButton editing={Boolean(editing)} />
          ) : (
            <p className="hint">
              Só administradores podem alterar as respostas automáticas.
            </p>
          )}
        </form>

        {message && (
          <p className="hint" style={{ marginTop: 0 }}>
            {message}
          </p>
        )}

        {editing && (
          <button type="button" onClick={() => setEditing(null)} style={{ width: "100%" }}>
            Cancelar edição
          </button>
        )}
      </div>
    </div>
  );
}
