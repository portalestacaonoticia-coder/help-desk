"use client";

import { useActionState } from "react";
import { unsubscribeContactAction } from "@/app/actions";

/**
 * Remove o contato do projeto da operação na Everinbox.
 *
 * Ação externa e sem desfazer pelo Help Desk — daí a confirmação antes de
 * enviar e o resultado sempre visível, inclusive quando falha.
 */
export default function UnsubscribeButton({
  threadId,
  contact,
  projectLinked,
}: {
  threadId: number;
  contact: string | null;
  projectLinked: boolean;
}) {
  const [result, action, pending] = useActionState(
    unsubscribeContactAction,
    undefined,
  );

  if (!projectLinked) {
    return (
      <p className="hint" style={{ marginTop: 12 }}>
        Para cancelar inscrição, ligue esta caixa a um projeto da Everinbox em
        Caixas de e-mail.
      </p>
    );
  }

  const failed = result?.startsWith("Falhou");

  return (
    <form
      action={action}
      style={{ marginTop: 12 }}
      onSubmit={(e) => {
        const ok = window.confirm(
          `Remover ${contact} do projeto na Everinbox? O contato deixa de receber os envios da operação.`,
        );
        if (!ok) e.preventDefault();
      }}
    >
      <input type="hidden" name="threadId" value={threadId} />
      <button
        type="submit"
        className="danger"
        disabled={pending || !contact}
        style={{ width: "100%" }}
      >
        {pending ? "Removendo…" : "Cancelar inscrição do contato"}
      </button>
      {result && (
        <p
          className={failed ? "error" : "ok-text"}
          style={{ fontSize: 12, marginTop: 8 }}
        >
          {result}
        </p>
      )}
    </form>
  );
}
