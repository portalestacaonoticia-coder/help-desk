"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  replyAction,
  reviewSuggestionAction,
  generateSuggestionAction,
} from "@/app/actions";

type MacroLite = { id: number; title: string; body: string; shortcut: string | null };

export type SuggestionLite = {
  id: number;
  summary: string | null;
  draft: string | null;
  confidence: number | null;
  category: string | null;
  model: string | null;
  errorMessage: string | null;
  sources: Array<{ id: number; title: string | null }>;
};

function SendButton() {
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

function PendingButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "Aguarde…" : children}
    </button>
  );
}

/** Botão de gerar/regenerar rascunho, com a mensagem de erro logo ao lado. */
function GenerateButton({
  threadId,
  messageId,
  label,
}: {
  threadId: number;
  messageId: number;
  label: string;
}) {
  const [error, action] = useActionState(generateSuggestionAction, undefined);

  return (
    <form action={action} style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <input type="hidden" name="threadId" value={threadId} />
      <input type="hidden" name="messageId" value={messageId} />
      <PendingButton>{label}</PendingButton>
      {error && (
        <span className="error" style={{ fontSize: 12 }}>
          {error}
        </span>
      )}
    </form>
  );
}

function SuggestionCard({
  suggestion,
  threadId,
  lastInboundId,
  signature,
  onUse,
}: {
  suggestion: SuggestionLite;
  threadId: number;
  lastInboundId: number | null;
  signature: string | null;
  onUse: (text: string) => void;
}) {
  const confidencePct =
    suggestion.confidence != null ? Math.round(suggestion.confidence * 100) : null;

  // Falha na chamada ao DeepSeek: mostra o erro e oferece nova tentativa.
  if (suggestion.errorMessage) {
    return (
      <div className="callout danger">
        <strong>A IA não conseguiu gerar o rascunho.</strong>
        <div style={{ marginTop: 6, fontSize: 12 }}>{suggestion.errorMessage}</div>
        {lastInboundId && (
          <div style={{ marginTop: 10 }}>
            <GenerateButton
              threadId={threadId}
              messageId={lastInboundId}
              label="Tentar de novo"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ai-card">
      <div className="ai-head">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m12 3-1.9 5.8L4.3 10.7l5.8 1.9L12 18.4l1.9-5.8 5.8-1.9-5.8-1.9z" />
        </svg>
        <span className="label">Sugestão de resposta</span>
        {confidencePct != null && (
          <span className="meta">confiança {confidencePct}%</span>
        )}
        {suggestion.category && <span className="pill">{suggestion.category}</span>}
      </div>

      {suggestion.summary && (
        <p className="ai-draft" style={{ fontWeight: 600 }}>
          {suggestion.summary}
        </p>
      )}

      <p className="ai-draft">{suggestion.draft}</p>

      <div className="ai-actions">
        <button
          type="button"
          className="primary"
          onClick={() =>
            onUse(
              signature
                ? `${suggestion.draft ?? ""}\n\n${signature}`
                : (suggestion.draft ?? ""),
            )
          }
        >
          Usar sugestão
        </button>

        {lastInboundId && (
          <GenerateButton
            threadId={threadId}
            messageId={lastInboundId}
            label="Regenerar"
          />
        )}

        <form action={reviewSuggestionAction}>
          <input type="hidden" name="id" value={suggestion.id} />
          <input type="hidden" name="threadId" value={threadId} />
          <input type="hidden" name="status" value="descartada" />
          <PendingButton>Descartar</PendingButton>
        </form>
      </div>

      {suggestion.sources.length > 0 && (
        <div className="ai-sources">
          <span>Fontes:</span>
          {suggestion.sources.map((s) => (
            <span key={s.id} className="pill">
              KB-{s.id} · {s.title ?? "(sem título)"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReplyArea({
  threadId,
  macros,
  suggestion,
  lastInboundId,
  signature,
  aiUnavailableReason,
}: {
  threadId: number;
  macros: MacroLite[];
  suggestion: SuggestionLite | null;
  lastInboundId: number | null;
  signature: string | null;
  aiUnavailableReason: string | null;
}) {
  const [body, setBody] = useState("");
  // Só marca a sugestão como "usada" se o agente realmente partiu dela — caso
  // contrário a trilha de auditoria diria que a IA acertou sem ter sido usada.
  // Guarda o id (e não um booleano) para que regenerar invalide o registro:
  // o rascunho novo não foi aproveitado só porque o antigo tinha sido.
  const [usedSuggestionId, setUsedSuggestionId] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  function insertText(text: string) {
    setBody((prev) => (prev ? `${prev}\n\n${text}` : text));
    ref.current?.focus();
  }

  /** "Usar sugestão" substitui o rascunho inteiro, em vez de concatenar. */
  function useSuggestion(text: string) {
    setBody(text);
    setUsedSuggestionId(suggestion?.id ?? null);
    ref.current?.focus();
  }

  return (
    <>
      {suggestion && (
        <SuggestionCard
          suggestion={suggestion}
          threadId={threadId}
          lastInboundId={lastInboundId}
          signature={signature}
          onUse={useSuggestion}
        />
      )}

      {!suggestion && aiUnavailableReason && lastInboundId && (
        <div className="callout">
          <strong>Sem rascunho da IA nesta conversa.</strong> {aiUnavailableReason}
          <div style={{ marginTop: 10 }}>
            <GenerateButton
              threadId={threadId}
              messageId={lastInboundId}
              label="Gerar rascunho agora"
            />
          </div>
        </div>
      )}

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
                onClick={() => insertText(m.body)}
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
            setUsedSuggestionId(null);
          }}
        >
          <input type="hidden" name="threadId" value={threadId} />
          {/* Marca a sugestão como usada quando ela virou o corpo do envio. */}
          {suggestion && usedSuggestionId === suggestion.id && (
            <input type="hidden" name="suggestionId" value={suggestion.id} />
          )}
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
            <SendButton />
          </div>
        </form>
      </div>
    </>
  );
}
