"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="login-wrap">
      <form action={formAction} className="card login-card">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tihee-mark.svg" alt="Tihee" width={36} height={36} />
          <div className="brand-name">
            <strong>Suporte Tihee</strong>
            <span>Central interna</span>
          </div>
        </div>

        <h1>Entrar</h1>
        <p>Acesse com sua conta do time de suporte.</p>

        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" required autoFocus />
        </div>

        <div className="field">
          <label htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" required />
        </div>

        {error && <p className="error">{error}</p>}

        <button
          type="submit"
          className="primary"
          disabled={pending}
          style={{ width: "100%", marginTop: 6 }}
        >
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
