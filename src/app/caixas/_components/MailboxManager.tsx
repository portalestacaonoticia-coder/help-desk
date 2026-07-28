"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveMailboxAction, testMailboxAction } from "@/app/actions";

export type MailboxLite = {
  id: number;
  label: string;
  operation: string | null;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpTls: boolean;
  fromAddress: string | null;
  signature: string | null;
  siteUrl: string | null;
  everinboxProjectId: string | null;
  active: boolean;
  lastUid: number;
  lastIngestAt: Date | string | null;
  lastIngestStatus: string | null;
  lastIngestMessage: string | null;
  lastOkAt: Date | string | null;
  /** Última tentativa falhou, mas houve entrada bem-sucedida recente. */
  flaky: boolean;
  threadCount: number;
};

function SaveButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="primary" disabled={pending} style={{ width: "100%" }}>
      {pending ? "Salvando…" : editing ? "Salvar alterações" : "Cadastrar caixa"}
    </button>
  );
}

function TestConnection({ id }: { id: number }) {
  const [result, action, pending] = useActionState(testMailboxAction, undefined);
  const failed = result?.includes("falhou");

  return (
    <form action={action} style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending}>
        {pending ? "Testando…" : "Testar conexão"}
      </button>
      {result && (
        <span className={failed ? "error" : "ok-text"} style={{ fontSize: 12 }}>
          {result}
        </span>
      )}
    </form>
  );
}

export default function MailboxManager({
  mailboxes,
  canEdit,
}: {
  mailboxes: MailboxLite[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<MailboxLite | null>(null);
  const formKey = editing?.id ?? "nova";

  return (
    <div className="macro-grid">
      <div className="card">
        <div className="card-head">
          Caixas conectadas
          {editing && (
            <button type="button" onClick={() => setEditing(null)}>
              Nova caixa
            </button>
          )}
        </div>

        {mailboxes.length === 0 ? (
          <div className="empty">
            Nenhuma caixa cadastrada. Adicione a primeira ao lado para a
            ingestão começar a rodar.
          </div>
        ) : (
          mailboxes.map((mb) => (
            <div
              key={mb.id}
              className={`macro-item${editing?.id === mb.id ? " selected" : ""}`}
            >
              <div className="head">
                <strong>{mb.operation || mb.label}</strong>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {mb.lastIngestStatus === "ok" && (
                    <span className="badge ok">Ingestão ok</span>
                  )}
                  {mb.flaky && <span className="badge neutral">Instável</span>}
                  {mb.lastIngestStatus === "error" && !mb.flaky && (
                    <span className="badge st-erro">Erro</span>
                  )}
                  {!mb.lastIngestStatus && (
                    <span className="badge neutral">Nunca rodou</span>
                  )}
                  {!mb.active && <span className="badge neutral">Inativa</span>}
                  {canEdit && (
                    <button type="button" onClick={() => setEditing(mb)}>
                      Editar
                    </button>
                  )}
                </span>
              </div>

              <div className="body">
                <span className="mono">{mb.imapUser}</span> · IMAP {mb.imapHost}:
                {mb.imapPort} · SMTP {mb.smtpHost}:{mb.smtpPort}
              </div>

              <div className="prop-row" style={{ marginTop: 10 }}>
                <span>Rótulo</span>
                <strong>{mb.label}</strong>
              </div>
              <div className="prop-row">
                <span>Última ingestão</span>
                <strong>
                  {mb.lastIngestAt
                    ? new Date(mb.lastIngestAt).toLocaleString("pt-BR")
                    : "nunca"}
                </strong>
              </div>
              <div className="prop-row">
                <span>Respostas</span>
                <strong>{mb.threadCount}</strong>
              </div>
              <div className="prop-row">
                <span>Último UID lido</span>
                <strong className="mono">{mb.lastUid}</strong>
              </div>

              <div className="prop-row">
                <span>Último e-mail entrou</span>
                <strong>
                  {mb.lastOkAt
                    ? new Date(mb.lastOkAt).toLocaleString("pt-BR")
                    : "nunca"}
                </strong>
              </div>

              {mb.lastIngestStatus === "error" && mb.lastIngestMessage && (
                <div
                  className={`callout ${mb.flaky ? "warn" : "danger"}`}
                  style={{ marginTop: 10 }}
                >
                  {mb.lastIngestMessage}
                </div>
              )}

              {canEdit && (
                <div style={{ marginTop: 12 }}>
                  <TestConnection id={mb.id} />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {canEdit && (
        <div className="card props">
          <span className="card-title">
            {editing
              ? `Editando ${editing.operation || editing.label}`
              : "Nova caixa"}
          </span>

          <form key={formKey} action={saveMailboxAction}>
            {editing && <input type="hidden" name="id" value={editing.id} />}

            <div className="field">
              <label htmlFor="operation">Operação</label>
              <input
                id="operation"
                name="operation"
                placeholder="Estação Finanças"
                defaultValue={editing?.operation ?? ""}
              />
              <span className="hint">
                Nome da operação que usa esta caixa. É o que aparece no menu
                lateral; em branco, usa o rótulo.
              </span>
            </div>

            <div className="field">
              <label htmlFor="label">Rótulo</label>
              <input
                id="label"
                name="label"
                required
                placeholder="Suporte"
                defaultValue={editing?.label ?? ""}
              />
            </div>

            <div className="hr" />

            <div className="field">
              <label htmlFor="imapHost">Servidor IMAP</label>
              <input
                id="imapHost"
                name="imapHost"
                required
                placeholder="mail.tihee.com.br"
                defaultValue={editing?.imapHost ?? ""}
              />
            </div>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="imapPort">Porta</label>
                <input
                  id="imapPort"
                  name="imapPort"
                  type="number"
                  defaultValue={editing?.imapPort ?? 993}
                />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label htmlFor="imapUser">Usuário</label>
                <input
                  id="imapUser"
                  name="imapUser"
                  required
                  placeholder="suporte@tihee.com.br"
                  defaultValue={editing?.imapUser ?? ""}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="imapPass">Senha IMAP</label>
              <input
                id="imapPass"
                name="imapPass"
                type="password"
                autoComplete="new-password"
                required={!editing}
                placeholder={editing ? "deixe em branco para manter" : ""}
              />
              <span className="hint">Cifrada com AES-256-GCM antes de ir ao banco.</span>
            </div>
            <label className="check">
              <input
                type="checkbox"
                name="imapTls"
                defaultChecked={editing?.imapTls ?? true}
              />
              <span>IMAP com TLS</span>
            </label>

            <div className="hr" style={{ margin: "16px 0" }} />

            <div className="field">
              <label htmlFor="smtpHost">Servidor SMTP</label>
              <input
                id="smtpHost"
                name="smtpHost"
                required
                placeholder="mail.tihee.com.br"
                defaultValue={editing?.smtpHost ?? ""}
              />
            </div>
            <div className="grid-3">
              <div className="field">
                <label htmlFor="smtpPort">Porta</label>
                <input
                  id="smtpPort"
                  name="smtpPort"
                  type="number"
                  defaultValue={editing?.smtpPort ?? 465}
                />
              </div>
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label htmlFor="smtpUser">Usuário</label>
                <input
                  id="smtpUser"
                  name="smtpUser"
                  placeholder="igual ao IMAP"
                  defaultValue={editing?.smtpUser ?? ""}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="smtpPass">Senha SMTP</label>
              <input
                id="smtpPass"
                name="smtpPass"
                type="password"
                autoComplete="new-password"
                placeholder={editing ? "deixe em branco para manter" : "igual à IMAP"}
              />
            </div>
            <label className="check">
              <input
                type="checkbox"
                name="smtpTls"
                defaultChecked={editing?.smtpTls ?? true}
              />
              <span>SMTP com TLS</span>
            </label>

            <div className="hr" style={{ margin: "16px 0" }} />

            <div className="field">
              <label htmlFor="fromAddress">Endereço de envio</label>
              <input
                id="fromAddress"
                name="fromAddress"
                placeholder="igual ao usuário IMAP"
                defaultValue={editing?.fromAddress ?? ""}
              />
            </div>
            <div className="field">
              <label htmlFor="signature">Assinatura</label>
              <textarea
                id="signature"
                name="signature"
                style={{ minHeight: 70 }}
                placeholder="Equipe Estação Finanças"
                defaultValue={editing?.signature ?? ""}
              />
              <span className="hint">
                Anexada às respostas desta caixa. Cada operação assina com o
                nome dela.
              </span>
            </div>

            <div className="field">
              <label htmlFor="siteUrl">Site da operação</label>
              <input
                id="siteUrl"
                name="siteUrl"
                type="url"
                placeholder="https://br.estacaofinancas.com"
                defaultValue={editing?.siteUrl ?? ""}
              />
              <span className="hint">
                A IA lê o sitemap deste site para responder com base nos posts.
              </span>
            </div>

            <div className="field">
              <label htmlFor="everinboxProjectId">Projeto na Everinbox</label>
              <input
                id="everinboxProjectId"
                name="everinboxProjectId"
                className="mono"
                placeholder="572c7b20-0a50-43cc-8566-fda73dfe9a81"
                defaultValue={editing?.everinboxProjectId ?? ""}
              />
              <span className="hint">
                ID do projeto ao qual esta operação está ligada. É dele que o
                contato sai ao cancelar a inscrição. Em branco, o botão não
                aparece no chamado.
              </span>
            </div>

            <label className="check" style={{ marginBottom: 14 }}>
              <input
                type="checkbox"
                name="active"
                defaultChecked={editing?.active ?? true}
              />
              <span>Caixa ativa na ingestão</span>
            </label>

            <SaveButton editing={Boolean(editing)} />
          </form>
        </div>
      )}
    </div>
  );
}
