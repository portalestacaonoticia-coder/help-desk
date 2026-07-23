"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="login-wrap">
      <form action={formAction} className="panel login-card">
        <h1>Help Desk</h1>
        <p>Central de suporte — Tihee</p>

        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" name="email" type="email" required autoFocus />
        </div>

        <div className="field">
          <label htmlFor="password">Senha</label>
          <input id="password" name="password" type="password" required />
        </div>

        {error && <p className="error">{error}</p>}

        <button type="submit" className="primary" disabled={pending} style={{ width: "100%" }}>
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
