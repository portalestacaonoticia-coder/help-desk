"use client";

import { useEffect } from "react";

/**
 * Error boundary das rotas. Sem ele o Next mostra só "Application error" com um
 * digest, sem pista nenhuma para quem está operando.
 *
 * Em produção o Next omite a mensagem original por segurança — o `digest` é a
 * chave para achar o stack completo nos logs do servidor (Vercel > Logs).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Erro ao renderizar a rota:", error);
  }, [error]);

  return (
    <div className="login-wrap">
      <div className="card login-card" style={{ maxWidth: 460 }}>
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tihee-mark.svg" alt="Tihee" width={36} height={36} />
          <div className="brand-name">
            <strong>Suporte Tihee</strong>
            <span>Central interna</span>
          </div>
        </div>

        <h1>Algo quebrou nesta tela</h1>
        <p>
          O erro foi registrado no servidor. Se acabou de sair um deploy, o mais
          provável é que falte rodar as migrations do banco.
        </p>

        {error.digest && (
          <div className="callout warn" style={{ marginBottom: 16 }}>
            Código do erro: <span className="mono">{error.digest}</span>
            <span className="hint">
              Busque por esse código nos logs do servidor para ver o stack.
            </span>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="primary" onClick={() => reset()}>
            Tentar de novo
          </button>
          <a href="/tickets" className="btn">
            Voltar para as respostas
          </a>
        </div>
      </div>
    </div>
  );
}
