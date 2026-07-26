"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS = {
  tickets: (
    <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  ),
  macros: (
    <path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  ),
} as const;

function NavItem({
  href,
  icon,
  label,
  count,
  active,
}: {
  href: string;
  icon: keyof typeof ICONS;
  label: string;
  count?: number;
  active: boolean;
}) {
  return (
    <Link href={href} className={`nav-item${active ? " active" : ""}`}>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICONS[icon]}
      </svg>
      <span>{label}</span>
      {count ? <span className="nav-count">{count}</span> : null}
    </Link>
  );
}

export default function Sidebar({
  openCount,
  agentName,
  agentInitials,
  agentRole,
}: {
  openCount: number;
  agentName: string;
  agentInitials: string;
  agentRole: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tihee-mark.svg" alt="Tihee" width={36} height={36} />
        <div className="brand-name">
          <strong>Suporte Tihee</strong>
          <span>Central interna</span>
        </div>
      </div>

      <nav className="nav">
        <div className="nav-section">Operação</div>
        <NavItem
          href="/tickets"
          icon="tickets"
          label="Chamados"
          count={openCount}
          active={pathname.startsWith("/tickets")}
        />

        <div className="nav-section">Conhecimento</div>
        <NavItem
          href="/macros"
          icon="macros"
          label="Respostas prontas"
          active={pathname.startsWith("/macros")}
        />
      </nav>

      <div className="sidebar-foot">
        <div className="stat-card">
          <div className="head">
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
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>Fila do turno</span>
          </div>
          <div className="num">{openCount}</div>
          <div className="sub">chamados aguardando atendimento</div>
        </div>

        <div className="agent">
          <div className="avatar lg">{agentInitials}</div>
          <div className="agent-name">
            <strong>{agentName}</strong>
            <span>{agentRole}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
