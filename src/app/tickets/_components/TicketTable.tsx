"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteThreadsAction } from "@/app/actions";
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
};

function DeleteButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="danger" disabled={pending}>
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
      action={deleteThreadsAction}
      onSubmit={(e) => {
        const n = selected.size;
        const ok = window.confirm(
          `Remover ${n} chamado${n === 1 ? "" : "s"}? As mensagens e os rascunhos da IA também são apagados. Não dá para desfazer.`,
        );
        if (!ok) e.preventDefault();
        else setSelected(new Set());
      }}
    >
      {canDelete && selected.size > 0 && (
        <div className="bulkbar">
          <span>
            {selected.size} selecionad{selected.size === 1 ? "o" : "os"}
          </span>
          <div className="bulkbar-actions">
            <button type="button" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </button>
            <DeleteButton count={selected.size} />
          </div>
        </div>
      )}

      <div className="card table">
        <div className={`trow thead${canDelete ? " selectable" : ""}`}>
          {canDelete && (
            <div>
              <input
                type="checkbox"
                aria-label="Selecionar todos desta página"
                checked={allSelected}
                onChange={toggleAll}
              />
            </div>
          )}
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
              className={`trow${canDelete ? " selectable" : ""}${
                selected.has(t.id) ? " selected" : ""
              }`}
            >
              {canDelete && (
                <div>
                  <input
                    type="checkbox"
                    name="ids"
                    value={t.id}
                    aria-label={`Selecionar chamado ${t.id}`}
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                </div>
              )}
              <Link href={`/tickets/${t.id}`} className="mono t-meta">
                #{t.id}
              </Link>
              <Link href={`/tickets/${t.id}`} style={{ minWidth: 0 }}>
                <div className="t-subject">{t.subject || "(sem assunto)"}</div>
                <div className="t-preview">
                  {t.customerAddr ? `${t.customerAddr} · ` : ""}
                  {fmtRelative(t.lastMessageAt)}
                  {t.preview ? ` · ${t.preview}` : ""}
                </div>
              </Link>
              <div>
                <span className={`tag ${colorClass(t.mailboxId)}`}>
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
