"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { replyAction } from "@/app/actions";

type MacroLite = { id: number; title: string; body: string; shortcut: string | null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="primary" disabled={pending}>
      {pending ? "Enviando…" : "Enviar resposta"}
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
    <div className="panel reply-box" style={{ padding: 16, marginTop: 16 }}>
      {macros.length > 0 && (
        <div style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
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
        <div className="reply-actions">
          <span className="muted" style={{ fontSize: 12 }}>
            Enviado via SMTP da caixa de origem, mantendo o encadeamento.
          </span>
          <SubmitButton />
        </div>
      </form>
    </div>
  );
}
