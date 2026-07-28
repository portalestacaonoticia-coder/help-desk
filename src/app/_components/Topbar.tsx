import { logoutAction } from "@/app/actions";

export default function Topbar({ query }: { query?: string }) {
  return (
    <header className="topbar">
      <form className="search" action="/tickets" method="get">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="hsl(222 15% 45%)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          name="q"
          defaultValue={query ?? ""}
          placeholder="Buscar resposta, assunto ou cliente"
          aria-label="Buscar"
        />
      </form>

      <div className="spacer" />

      <div className="presence">
        <span className="dot" />
        Disponível
      </div>

      <form action={logoutAction}>
        <button type="submit">Sair</button>
      </form>
    </header>
  );
}
