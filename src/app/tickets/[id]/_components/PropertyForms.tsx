"use client";

import { useActionState } from "react";
import { setStatusAction, setCategoryAction } from "@/app/actions";
import { STATUS_LABELS, CATEGORIES } from "@/lib/ui";

/** Mensagem de retorno da action. Erro em vermelho, sucesso em verde. */
function Feedback({ text }: { text?: string }) {
  if (!text) return null;
  const failed = text.startsWith("Falhou") || text.endsWith("inválido.") || text.endsWith("inválida.");
  return (
    <p
      className={failed ? "error" : "ok-text"}
      style={{ fontSize: 12, marginTop: 8 }}
      role="status"
    >
      {text}
    </p>
  );
}

export function StatusForm({
  threadId,
  status,
}: {
  threadId: number;
  status: string;
}) {
  const [result, action, pending] = useActionState(setStatusAction, undefined);

  return (
    <form action={action}>
      <input type="hidden" name="threadId" value={threadId} />
      <label htmlFor="status">Status</label>
      {/* key remonta o select quando o servidor manda um valor novo:
          `defaultValue` só é lido na montagem, então sem isso o campo
          continuaria mostrando o valor antigo depois de salvar. Digitar não
          remonta nada — só props novas mudam a key. */}
      <select key={status} id="status" name="status" defaultValue={status}>
        {Object.entries(STATUS_LABELS).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        style={{ marginTop: 8, width: "100%" }}
      >
        {pending ? "Salvando…" : "Atualizar status"}
      </button>
      <Feedback text={result} />
    </form>
  );
}

export function CategoryForm({
  threadId,
  category,
}: {
  threadId: number;
  category: string | null;
}) {
  const [result, action, pending] = useActionState(setCategoryAction, undefined);

  return (
    <form action={action} style={{ marginTop: 14 }}>
      <input type="hidden" name="threadId" value={threadId} />
      <label htmlFor="category">Categoria</label>
      {/* Mesmo motivo do select de status: remonta ao receber valor novo. */}
      <select
        key={category ?? ""}
        id="category"
        name="category"
        defaultValue={category ?? ""}
      >
        <option value="">Sem categoria</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        style={{ marginTop: 8, width: "100%" }}
      >
        {pending ? "Salvando…" : "Atualizar categoria"}
      </button>
      <Feedback text={result} />
    </form>
  );
}
