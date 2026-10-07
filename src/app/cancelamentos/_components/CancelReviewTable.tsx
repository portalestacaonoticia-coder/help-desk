"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ignoreFlaggedContactsAction,
  unsubscribeFlaggedContactAction,
} from "@/app/actions";
import type { FlaggedContact } from "@/lib/cancel-review";
import { colorClass, fmtRelative } from "@/lib/ui";

type RowState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; ok: boolean; message: string };

/**
 * Lista de contatos com seleção em lote.
 *
 * O descadastramento roda UM contato por vez, em sequência, chamando a action
 * para cada um: a Everinbox leva até 25s por projeto, e um lote inteiro numa
 * chamada só estouraria o tempo da função sem dizer quem saiu. Assim cada
 * linha mostra o próprio resultado, e dá para fechar a aba no meio sem
 * perder o que já foi feito.
 *
 * Ao fim do lote a lista é recarregada do servidor uma vez: os tratados
 * somem, os que falharam continuam, com o erro na linha.
 */
export default function CancelReviewTable({
  contacts,
  everinboxOk,
}: {
  contacts: FlaggedContact[];
  everinboxOk: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const selectable = contacts.filter((c) => rows[c.key]?.kind !== "done");
  const allSelected =
    selectable.length > 0 && selectable.every((c) => selected.has(c.key));

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map((c) => c.key)));
  }

  function setRow(key: string, state: RowState) {
    setRows((prev) => ({ ...prev, [key]: state }));
  }

  async function unsubscribeSelected() {
    const alvo = contacts.filter((c) => selected.has(c.key));
    if (alvo.length === 0) return;

    const ok = window.confirm(
      `Cancelar a inscrição de ${alvo.length} contato${alvo.length === 1 ? "" : "s"} na Everinbox? ${
        alvo.length === 1 ? "Ele deixa" : "Eles deixam"
      } de receber os envios da operação. Não dá para desfazer pelo Help Desk.`,
    );
    if (!ok) return;

    setBusy(true);
    setSummary(null);
    let sucesso = 0;
    let falha = 0;

    for (const c of alvo) {
      setRow(c.key, { kind: "running" });
      try {
        const r = await unsubscribeFlaggedContactAction({
          mailboxId: c.mailboxId,
          email: c.email,
          lastMessageId: c.lastMessageId,
        });
        setRow(c.key, { kind: "done", ok: r.ok, message: r.message });
        if (r.ok) sucesso++;
        else falha++;
      } catch (err) {
        setRow(c.key, {
          kind: "done",
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        });
        falha++;
      }
    }

    setSelected(new Set());
    setBusy(false);
    setSummary(
      `Pronto: ${sucesso} contato${sucesso === 1 ? "" : "s"} descadastrado${
        sucesso === 1 ? "" : "s"
      } na Everinbox e retirado${sucesso === 1 ? "" : "s"} da lista.${
        falha > 0
          ? ` ${falha} ${falha === 1 ? "falhou e continua" : "falharam e continuam"} na lista, com o motivo na linha.`
          : ""
      } Para rever os tratados, use o filtro "Já tratados".`,
    );
    router.refresh();
  }

  async function ignoreSelected() {
    const alvo = contacts.filter((c) => selected.has(c.key));
    if (alvo.length === 0) return;

    setBusy(true);
    setSummary(null);
    try {
      const r = await ignoreFlaggedContactsAction(
        alvo.map((c) => ({
          mailboxId: c.mailboxId,
          email: c.email,
          lastMessageId: c.lastMessageId,
        })),
      );
      for (const c of alvo) {
        setRow(c.key, { kind: "done", ok: r.ok, message: r.ok ? "Ignorado." : r.message });
      }
      setSummary(
        r.ok
          ? `Pronto: ${r.message} Saíram da lista; para rever, use o filtro "Já tratados".`
          : r.message,
      );
      setSelected(new Set());
      if (r.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const n = selected.size;

  return (
    <div>
      {n > 0 && (
        <div className="bulkbar">
          <span>
            {n} selecionad{n === 1 ? "o" : "os"}
          </span>
          <div className="bulkbar-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setSelected(new Set())}
            >
              Limpar seleção
            </button>
            <button type="button" disabled={busy} onClick={ignoreSelected}>
              Ignorar {n}
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy || !everinboxOk}
              title={everinboxOk ? undefined : "EVERINBOX_API_KEY não configurada"}
              onClick={unsubscribeSelected}
            >
              {busy ? "Cancelando…" : `Cancelar inscrição de ${n}`}
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="callout" style={{ marginBottom: 12 }}>
          {summary}
        </div>
      )}

      <div className="card table">
        <div className="trow thead cancel-row">
          <div>
            <input
              type="checkbox"
              aria-label="Selecionar todos"
              checked={allSelected}
              disabled={busy || selectable.length === 0}
              onChange={toggleAll}
            />
          </div>
          <div>Contato</div>
          <div>Termos</div>
          <div>Última mensagem</div>
          <div>Situação</div>
        </div>

        {contacts.length === 0 ? (
          <div className="empty">
            Nenhum contato escreveu os termos de cancelamento neste período.
          </div>
        ) : (
          contacts.map((c) => {
            const state = rows[c.key] ?? { kind: "idle" };
            const done = state.kind === "done";
            return (
              <div
                key={c.key}
                className={`trow cancel-row${selected.has(c.key) ? " selected" : ""}`}
              >
                <div>
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${c.email}`}
                    checked={selected.has(c.key)}
                    disabled={busy || done}
                    onChange={() => toggle(c.key)}
                  />
                </div>

                <div style={{ minWidth: 0 }}>
                  <div className="t-subject" title={c.email}>
                    {c.email}
                  </div>
                  <div className="t-preview">
                    <span className={`tag ${colorClass(c.mailboxId)}`}>
                      {c.mailboxName}
                    </span>
                    {!c.projectLinked && (
                      <span className="t-meta"> · caixa sem projeto na Everinbox</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="chips">
                    {c.terms.map((t) => (
                      <span key={t} className="pill">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="t-meta" title={c.words.join(", ")}>
                    {c.hits === 1 ? "1 mensagem" : `${c.hits} mensagens`}
                    {" · "}
                    escreveu: {c.words.slice(0, 3).join(", ")}
                  </div>
                </div>

                <Link href={`/tickets/${c.lastThreadId}`} style={{ minWidth: 0 }}>
                  <div className="t-subject">
                    #{c.lastThreadId} {c.lastSubject || "(sem assunto)"}
                  </div>
                  <div className="t-preview" title={c.excerpt}>
                    {fmtRelative(c.lastAt)} · {c.excerpt}
                  </div>
                </Link>

                <div>
                  {state.kind === "running" ? (
                    <span className="badge neutral">Cancelando…</span>
                  ) : done ? (
                    <span
                      className={state.ok ? "ok-text" : "error"}
                      style={{ fontSize: 12 }}
                      title={state.message}
                    >
                      {state.ok ? "✓ " : "✗ "}
                      {state.message}
                    </span>
                  ) : c.handled ? (
                    <span className="badge neutral" title={c.previous?.reviewedAt ? fmtRelative(c.previous.reviewedAt) : undefined}>
                      {c.previous?.status === "descadastrado" ? "Descadastrado" : "Ignorado"}
                    </span>
                  ) : c.previous ? (
                    <span
                      className="badge auto"
                      title={`${c.previous.status} ${fmtRelative(c.previous.reviewedAt)} — escreveu de novo depois disso`}
                    >
                      Voltou a escrever
                    </span>
                  ) : (
                    <span className="badge st-aberto">Aguardando</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
