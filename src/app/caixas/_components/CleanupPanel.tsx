"use client";

import { useActionState, useState } from "react";
import { cleanupThreadsAction } from "@/app/actions";

/**
 * Limpeza sob demanda. Some com respostas antigas para devolver espaço ao
 * banco — o corpo dos e-mails é o que enche o Neon.
 *
 * A idade é sempre aplicada e nunca menor que 1 dia: sem esse piso, desmarcar
 * as duas caixas apagaria a fila inteira num clique.
 */
export default function CleanupPanel({ total }: { total: number }) {
  const [result, action, pending] = useActionState(cleanupThreadsAction, undefined);
  const [dias, setDias] = useState(7);
  const [somenteFechadas, setSomenteFechadas] = useState(true);
  const [semResposta, setSemResposta] = useState(false);

  const failed = result?.startsWith("Falhou");

  const alvo = [
    `com mais de ${dias} dia${dias === 1 ? "" : "s"}`,
    somenteFechadas ? "fechadas" : null,
    semResposta ? 'categorizadas como "Sem Resposta"' : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="card pad">
      <div style={{ marginBottom: 14 }}>
        <div className="card-title">Limpeza do banco</div>
        <p className="page-sub" style={{ fontSize: 13 }}>
          Remove respostas antigas com suas mensagens e rascunhos da IA. Hoje há{" "}
          {total} resposta{total === 1 ? "" : "s"} no total.
        </p>
      </div>

      <form
        action={action}
        onSubmit={(e) => {
          const ok = window.confirm(
            `Remover respostas ${alvo}?\n\nAs mensagens e os rascunhos da IA vão junto. Não dá para desfazer.`,
          );
          if (!ok) e.preventDefault();
        }}
      >
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="dias">Mais antigas que (dias)</label>
          <input
            id="dias"
            name="dias"
            type="number"
            min={1}
            value={dias}
            onChange={(e) => setDias(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>

        <label className="check">
          <input
            type="checkbox"
            name="somenteFechadas"
            checked={somenteFechadas}
            onChange={(e) => setSomenteFechadas(e.target.checked)}
          />
          <span>Somente respostas fechadas</span>
        </label>

        <label className="check">
          <input
            type="checkbox"
            name="semResposta"
            checked={semResposta}
            onChange={(e) => setSemResposta(e.target.checked)}
          />
          <span>Somente categorizadas como &quot;Sem Resposta&quot;</span>
        </label>

        <div
          className={`callout ${!somenteFechadas && !semResposta ? "danger" : "warn"}`}
          style={{ marginTop: 14 }}
        >
          Vai remover respostas <strong>{alvo}</strong>.
          {!somenteFechadas && !semResposta && (
            <> Sem nenhum filtro além da idade, isso inclui respostas em aberto.</>
          )}
        </div>

        <button
          type="submit"
          className="danger"
          disabled={pending}
          style={{ marginTop: 14 }}
        >
          {pending ? "Removendo…" : "Remover respostas"}
        </button>

        {result && (
          <p
            className={failed ? "error" : "ok-text"}
            style={{ fontSize: 13, marginTop: 10 }}
          >
            {result}
          </p>
        )}
      </form>
    </div>
  );
}
