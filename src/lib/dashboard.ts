import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  fmtPct,
  pct,
  type Alerta,
  type ContaMetricas,
  type DashboardData,
  type Periodo,
  type Ponto,
} from "@/lib/dashboard-fmt";

// Reexporta para a página consumir tudo de um lugar só.
export * from "@/lib/dashboard-fmt";

/**
 * Métricas da dashboard executiva.
 *
 * Mapeamento entre o vocabulário do documento e o modelo do banco:
 *  - "conta"            → caixa (`mailboxes`), exibida pelo nome da operação
 *  - "caixa de entrada" → mensagens inbound no período
 *  - "respondidos"      → inbound que receberam um outbound depois, na mesma
 *                          thread. Contar outbound direto inflaria o número
 *                          quando o agente manda duas mensagens seguidas.
 *  - "cancelamentos"    → inbound cuja thread está categorizada "Cancelamento"
 *  - "tempo de resposta"→ do inbound até o PRIMEIRO outbound posterior
 */

const UNIT: Record<Periodo, string> = {
  dia: "day",
  semana: "week",
  mes: "month",
};

/** Quantos períodos o gráfico mostra, incluindo o atual. */
const BUCKETS: Record<Periodo, number> = { dia: 14, semana: 12, mes: 12 };

const TZ = "America/Sao_Paulo";

type Linha = {
  bucket: string;
  mailbox_id: number;
  nome: string;
  entradas: number;
  respondidos: number;
  cancelamentos: number;
  tempo_medio_seg: number;
};

/**
 * Uma consulta só, agrupada por período e caixa. Tudo o mais é agregação em
 * memória — são poucas linhas (períodos × caixas) e evita ida extra ao banco.
 *
 * SQL cru de propósito: dentro de template `sql` o drizzle renderiza colunas
 * sem o prefixo da tabela, o que quebraria as correlações deste join.
 */
export async function getDashboard(
  periodo: Periodo,
  mailboxId: number | null,
): Promise<DashboardData> {
  const unit = UNIT[periodo];
  const n = BUCKETS[periodo];

  const filtroCaixa = mailboxId
    ? sql`and m.mailbox_id = ${mailboxId}`
    : sql``;

  // Intervalos entram como literal: `interval` não aceita parâmetro no lugar
  // da unidade. `unit` e `n` vêm de mapas fixos indexados por um tipo fechado,
  // então não há entrada do usuário nessa string.
  const janela = sql.raw(`interval '${n - 1} ${unit}'`);
  const passo = sql.raw(`interval '1 ${unit}'`);

  const rows = await db.execute<Linha>(sql`
    with periodos as (
      select generate_series(
        date_trunc(${unit}, (now() at time zone ${TZ})) - ${janela},
        date_trunc(${unit}, (now() at time zone ${TZ})),
        ${passo}
      ) as bucket
    ),
    entradas as (
      select
        date_trunc(${unit}, (coalesce(m.sent_at, m.created_at) at time zone ${TZ})) as bucket,
        m.mailbox_id,
        count(*)::int as entradas,
        count(r.respondida_em)::int as respondidos,
        count(*) filter (where t.category = 'Cancelamento')::int as cancelamentos,
        coalesce(
          avg(extract(epoch from (r.respondida_em - coalesce(m.sent_at, m.created_at))))
            filter (where r.respondida_em is not null),
          0
        )::float8 as tempo_medio_seg
      from messages m
      join threads t on t.id = m.thread_id
      left join lateral (
        select min(o.sent_at) as respondida_em
        from messages o
        where o.thread_id = m.thread_id
          and o.direction = 'outbound'
          and o.sent_at > coalesce(m.sent_at, m.created_at)
      ) r on true
      where m.direction = 'inbound'
        and coalesce(m.sent_at, m.created_at) >=
          ((select min(bucket) from periodos) at time zone ${TZ})
        ${filtroCaixa}
      group by 1, 2
    )
    select
      to_char(p.bucket, 'YYYY-MM-DD') as bucket,
      coalesce(e.mailbox_id, 0) as mailbox_id,
      coalesce(nullif(mb.operation, ''), mb.label, '—') as nome,
      coalesce(e.entradas, 0) as entradas,
      coalesce(e.respondidos, 0) as respondidos,
      coalesce(e.cancelamentos, 0) as cancelamentos,
      coalesce(e.tempo_medio_seg, 0) as tempo_medio_seg
    from periodos p
    left join entradas e on e.bucket = p.bucket
    left join mailboxes mb on mb.id = e.mailbox_id
    order by p.bucket
  `);

  const linhas = [...rows];

  // Série consolidada: soma as caixas de cada período.
  const porBucket = new Map<string, Ponto>();
  for (const l of linhas) {
    const atual = porBucket.get(l.bucket) ?? {
      bucket: l.bucket,
      entradas: 0,
      respondidos: 0,
      cancelamentos: 0,
      tempoMedioSeg: 0,
    };
    atual.entradas += Number(l.entradas);
    atual.respondidos += Number(l.respondidos);
    atual.cancelamentos += Number(l.cancelamentos);
    // Guarda a soma ponderada; divide depois.
    atual.tempoMedioSeg += Number(l.tempo_medio_seg) * Number(l.respondidos);
    porBucket.set(l.bucket, atual);
  }

  const serie = [...porBucket.values()]
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
    .map((p) => ({
      ...p,
      // Média ponderada pelo volume de respondidos, como manda o documento.
      tempoMedioSeg: p.respondidos > 0 ? p.tempoMedioSeg / p.respondidos : 0,
    }));

  const vazio: Ponto = {
    bucket: "",
    entradas: 0,
    respondidos: 0,
    cancelamentos: 0,
    tempoMedioSeg: 0,
  };
  const atual = serie[serie.length - 1] ?? vazio;
  const anterior = serie[serie.length - 2] ?? vazio;

  // Tabela por conta: só o período corrente.
  const contas = linhas
    .filter((l) => l.bucket === atual.bucket && Number(l.mailbox_id) > 0)
    .map((l) => ({
      mailboxId: Number(l.mailbox_id),
      nome: l.nome,
      bucket: l.bucket,
      entradas: Number(l.entradas),
      respondidos: Number(l.respondidos),
      cancelamentos: Number(l.cancelamentos),
      tempoMedioSeg: Number(l.tempo_medio_seg),
    }))
    .sort((a, b) => b.entradas - a.entradas);

  return {
    periodo,
    serie,
    atual,
    anterior,
    contas,
    diasNoPeriodo: periodo === "dia" ? 1 : periodo === "semana" ? 7 : 30,
  };
}

/* ------------------------------------------------------------------ */
/* Alertas                                                             */
/* ------------------------------------------------------------------ */

/** Janela fixa de 3 períodos para os alertas de tendência. */
const JANELA_TENDENCIA = 3;

export function gerarAlertas(d: DashboardData): Alerta[] {
  const alertas: Alerta[] = [];
  const { atual, serie } = d;

  const taxaResposta = pct(atual.respondidos, atual.entradas);
  if (atual.entradas > 0 && taxaResposta < 80) {
    alertas.push({
      nivel: "danger",
      texto: `Taxa de resposta em ${fmtPct(taxaResposta)}, abaixo dos 80% esperados.`,
    });
  }

  const taxaCancel = pct(atual.cancelamentos, atual.entradas);
  if (atual.entradas > 0 && taxaCancel > 10) {
    alertas.push({
      nivel: "danger",
      texto: `Taxa de cancelamento em ${fmtPct(taxaCancel)}, acima do limite de 10%.`,
    });
  }

  // Tendências: exigem a janela cheia, senão qualquer oscilação vira alerta.
  const ultimos = serie.slice(-JANELA_TENDENCIA);
  if (ultimos.length === JANELA_TENDENCIA) {
    const subindo = ultimos.every(
      (p, i) => i === 0 || p.tempoMedioSeg > ultimos[i - 1].tempoMedioSeg,
    );
    if (subindo && ultimos[0].tempoMedioSeg > 0) {
      alertas.push({
        nivel: "warn",
        texto: `Tempo médio de resposta cresce há ${JANELA_TENDENCIA} períodos seguidos.`,
      });
    }

    if (ultimos.every((p) => p.entradas > p.respondidos)) {
      alertas.push({
        nivel: "warn",
        texto: `Entradas superam respostas há ${JANELA_TENDENCIA} períodos seguidos — a fila está acumulando.`,
      });
    }
  }

  return alertas;
}
