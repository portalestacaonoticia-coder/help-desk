export const STATUS_LABELS: Record<string, string> = {
  novo: "Novo",
  em_andamento: "Em andamento",
  aguardando_cliente: "Aguardando cliente",
  resolvido: "Resolvido",
};

export function initials(value: string | null | undefined): string {
  if (!value) return "—";
  const name = value.includes("@") ? value.split("@")[0] : value;
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!)
    .join("")
    .toUpperCase();
}

/** Uma das 6 cores do ecossistema, estável por id — usada em tags e avatares. */
export function colorClass(id: number | null | undefined): string {
  return `c${((id ?? 0) % 6) + 1}`;
}

export function fmtDateTime(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelative(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "há 1 dia";
  if (days < 30) return `há ${days} dias`;
  return fmtDateTime(date);
}
