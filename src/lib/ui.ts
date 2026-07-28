export const STATUS_LABELS: Record<string, string> = {
  aberto: "Aberto",
  fechado: "Fechado",
};

/**
 * Categorias da triagem. São FIXAS: quem classifica é o agente, na tela do
 * chamado, e a lista não muda por operação. Mexer aqui muda a aplicação
 * inteira — não há mais tela de cadastro.
 */
export const CATEGORIES = [
  "Interesse",
  "Reclamação",
  "Cancelamento",
  "Sem Resposta",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

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

// Estas datas são formatadas no servidor, que na Vercel roda em UTC. Sem fixar
// o fuso, um chamado criado 14:15 aparecia como 17:15 — três horas à frente,
// muitas vezes "no futuro" em relação ao relógio de quem olha.
const TIMEZONE = "America/Sao_Paulo";

export function fmtDateTime(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("pt-BR", {
    timeZone: TIMEZONE,
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
