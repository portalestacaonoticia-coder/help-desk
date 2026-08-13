"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteThreadsAction, bulkSetStatusAction } from "@/app/actions";
import { STATUS_LABELS, colorClass, fmtRelative } from "@/lib/ui";

export type TicketRow = {
  id: number;
  subject: string | null;
  customerAddr: string | null;
  status: string;
  category: string | null;
  lastMessageAt: Date | string;
  mailboxId: number;
  mailboxLabel: string;
  preview: string;
  /** A última mensagem da conversa é nossa, não do cliente. */
  answered: boolean;
  /** A última resposta saiu pela IA, sem revisão de ninguém. */
  answeredByAi: boolean;
};

function DeleteButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="danger"
      disabled={pending}
      // formAction sobrescreve a action do form só para este botão.
      formAction={deleteThreadsAction}
      data-acao="remover"
    >
      {pending
        ? "Removendo…"
        : `Remover ${count} selecionad${count === 1 ? "o" : "os"}`}
    </button>
  );
}

export default function TicketTable({
  rows,
  canDelete,
}: {
  rows: TicketRow[];
  canDelete: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    // "Todos" age sobre a página visível — nunca sobre o resultado inteiro do
    // filtro, para não apagar em massa o que não está na tela.
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  return (
    <form
      action={bulkSetStatusAction}
      onSubmit={(e) => {
        // Qual botão disparou decide se precisa confirmar: mudar status é
        // reversível, apagar não.
        const submitter = (e.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement | null;

        if (submitter?.dataset.acao === "remover") {
          const n = selected.size;
          const ok = window.confirm(
            `Remover ${n} resposta${n === 1 ? "" : "s"}? As mensagens e os rascunhos da IA também são apagados. Não dá para desfazer.`,
          );
          if (!ok) {
            e.preventDefault();
            return;
          }
        }
        setSelected(new Set());
      }}
    >
      {selected.size > 0 && (
        <div className="bulkbar">
          <span>
            {selected.size} selecionad{selected.size === 1 ? "o" : "os"}
          </span>
          <div className="bulkbar-actions">
            <button type="button" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </button>
            {Object.entries(STATUS_LABELS).map(([valor, rotulo]) => (
              <button key={valor} type="submit" name="status" value={valor}>
                Marcar como {rotulo.toLowerCase()}
              </button>
            ))}
            {canDelete && <DeleteButton count={selected.size} />}
          </div>
        </div>
      )}

      <div className="card table">
        <div className="trow thead selectable">
          <div>
            <input
              type="checkbox"
              aria-label="Selecionar todos desta página"
              checked={allSelected}
              onChange={toggleAll}
            />
          </div>
          <div>ID</div>
          <div>Assunto</div>
          <div>Operação</div>
          <div className="col-hide">Categoria</div>
          <div>Status</div>
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            Nenhuma resposta encontrada. Assim que a ingestão IMAP rodar, os
            e-mails aparecem aqui.
          </div>
        ) : (
          rows.map((t) => (
            <div
              key={t.id}
              className={`trow selectable${selected.has(t.id) ? " selected" : ""}`}
            >
              <div>
                <input
                  type="checkbox"
                  name="ids"
                  value={t.id}
                  aria-label={`Selecionar resposta ${t.id}`}
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                />
              </div>
              <Link href={`/tickets/${t.id}`} className="mono t-meta">
                #{t.id}
              </Link>
              <Link href={`/tickets/${t.id}`} style={{ minWidth: 0 }}>
                <div className="t-subject">
                  {t.subject || "(sem assunto)"}
                  {/* Dois selos distintos: "Respondido" continua significando
                      que um agente escreveu. O que saiu sozinho tem selo
                      próprio — é o que alguém precisa reler primeiro. */}
                  {t.answered && (
                    <span className={`badge ${t.answeredByAi ? "auto" : "ok"}`}>
                      {t.answeredByAi
                        ? "Respondido Automaticamente"
                        : "Respondido"}
                    </span>
                  )}
                </div>
                <div className="t-preview">
                  {t.customerAddr ? `${t.customerAddr} · ` : ""}
                  {fmtRelative(t.lastMessageAt)}
                  {t.preview ? (
                    <>
                      {" · "}
                      {/* Deixa claro de quem é o texto da prévia. */}
                      {t.answered && (
                        <strong>
                          {t.answeredByAi
                            ? "Resposta automática: "
                            : "Nossa resposta: "}
                        </strong>
                      )}
                      {t.preview}
                    </>
                  ) : null}
                </div>
              </Link>
              <div>
                <span
                  className={`tag ${colorClass(t.mailboxId)}`}
                  title={t.mailboxLabel}
                >
                  {t.mailboxLabel}
                </span>
              </div>
              <div className="col-hide">
                {t.category ? (
                  <span className="pill">{t.category}</span>
                ) : (
                  <span className="t-meta">—</span>
                )}
              </div>
              <div>
                <span className={`badge st-${t.status}`}>
                  {STATUS_LABELS[t.status] ?? t.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </form>
  );
}
