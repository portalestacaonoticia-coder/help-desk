/**
 * Tipos e formatação da dashboard, sem nenhuma dependência de banco.
 *
 * Vive separado de `dashboard.ts` de propósito: o gráfico é componente cliente
 * e importar de lá arrastaria o driver do Postgres para o bundle do navegador.
 */

export type Periodo = "dia" | "semana" | "mes";

export const PERIODO_LABEL: Record<Periodo, string> = {
  dia: "Dia",
  semana: "Semana",
  mes: "Mês",
};

export function isPeriodo(v: string): v is Periodo {
  return v === "dia" || v === "semana" || v === "mes";
}

export type Ponto = {
  /** Início do período, em ISO. */
  bucket: string;
  entradas: number;
  respondidos: number;
  cancelamentos: number;
  /** Média do período, em segundos. 0 quando não houve resposta. */
  tempoMedioSeg: number;
};

export type ContaMetricas = Ponto & {
  mailboxId: number;
  nome: string;
};

export type DashboardData = {
  periodo: Periodo;
  /** Série temporal consolidada, do mais antigo ao mais recente. */
  serie: Ponto[];
  /** Período corrente e o anterior, para a variação dos KPIs. */
  atual: Ponto;
  anterior: Ponto;
  /** Uma linha por conta no período corrente. */
  contas: ContaMetricas[];
  /** Divisor da média diária dos cards. */
  diasNoPeriodo: number;
};

export type Alerta = { nivel: "warn" | "danger"; texto: string };

/** "2h 15m". Zero vira "—" para não sugerir resposta instantânea. */
export function fmtDuracao(segundos: number): string {
  if (!segundos || segundos <= 0) return "—";
  const h = Math.floor(segundos / 3600);
  const m = Math.round((segundos % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Variação percentual. `null` quando não há base de comparação. */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return ((atual - anterior) / anterior) * 100;
}

export function pct(parte: number, total: number): number {
  return total > 0 ? (parte / total) * 100 : 0;
}

export function fmtPct(v: number): string {
  return `${v.toFixed(1).replace(".", ",")}%`;
}

/** Rótulo curto do eixo X, conforme o período. */
export function fmtBucket(bucket: string, periodo: Periodo): string {
  const [ano, mes, dia] = bucket.split("-");
  if (periodo === "mes") return `${mes}/${ano.slice(2)}`;
  return `${dia}/${mes}`;
}
