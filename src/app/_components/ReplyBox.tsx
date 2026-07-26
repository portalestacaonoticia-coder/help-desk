"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { replyAction } from "@/app/actions";

type MacroLite = { id: number; title: string; body: string; shortcut: string | null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="primary" disabled={pending}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </svg>
      {pending ? "Enviando…" : "Enviar"}
    </button>
  );
}

export default function ReplyBox({
  threadId,
  macros,
}: {
  threadId: number;
  macros: MacroLite[];
}) {
  const [body, setBody] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function insertMacro(text: string) {
    setBody((prev) => (prev ? `${prev}\n\n${text}` : text));
    ref.current?.focus();
  }

  return (
    <div className="card composer">
      <div className="composer-tabs">
        <span>Responder</span>
      </div>

      {macros.length > 0 && (
        <div className="macro-bar">
          {macros.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => insertMacro(m.body)}
              title={m.body}
            >
              {m.shortcut ?? m.title}
            </button>
          ))}
        </div>
      )}

      <form
        action={async (fd) => {
          await replyAction(fd);
          setBody("");
        }}
      >
        <input type="hidden" name="threadId" value={threadId} />
        <textarea
          ref={ref}
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Escreva a resposta ao cliente…"
          required
        />
        <div className="composer-actions" style={{ marginTop: 12 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            Enviado via SMTP da caixa de origem, mantendo o encadeamento.
          </span>
          <div className="spacer" />
          <SubmitButton />
        </div>
      </form>
    </div>
  );
}
