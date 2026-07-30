"use client";

import { useState } from "react";
import {
  fmtBucket,
  fmtDuracao,
  fmtPct,
  pct,
  type Periodo,
  type Ponto,
} from "@/lib/dashboard-fmt";

/**
 * Gráfico de linha multi-séries com painel de seleção ao lado.
 *
 * SVG à mão em vez de biblioteca: são 7 séries e um eixo, e adicionar uma
 * dependência de gráficos custaria mais peso do que o desenho inteiro.
 *
 * As séries convivem em escalas incompatíveis (volume, %, tempo), então todas
 * são normalizadas para 0–100 no desenho — o valor real fica no tooltip. Dois
 * eixos Y na mesma área tornariam a leitura pior, não melhor.
 */

type SerieKey =
  | "entradas"
  | "entradasPct"
  | "respondidos"
  | "respondidosPct"
  | "tempo"
  | "cancelamentos"
  | "cancelamentosPct";

type Def = {
  key: SerieKey;
  nome: string;
  cor: string;
  /** Valor real do ponto, na unidade da série. */
  valor: (p: Ponto, total: number) => number;
  fmt: (v: number) => string;
  /** Ligada por padrão. */
  inicial?: boolean;
};

const SERIES: Def[] = [
  {
    key: "entradas",
    nome: "Caixa de entrada",
    cor: "hsl(222 70% 55%)",
    valor: (p) => p.entradas,
    fmt: (v) => String(Math.round(v)),
    inicial: true,
  },
  {
    key: "entradasPct",
    nome: "Caixa de entrada (%)",
    cor: "hsl(222 40% 70%)",
    valor: (p, total) => pct(p.entradas, total),
    fmt: fmtPct,
  },
  {
    key: "respondidos",
    nome: "E-mails respondidos",
    cor: "hsl(145 60% 40%)",
    valor: (p) => p.respondidos,
    fmt: (v) => String(Math.round(v)),
    inicial: true,
  },
  {
    key: "respondidosPct",
    nome: "E-mails respondidos (%)",
    cor: "hsl(145 45% 58%)",
    valor: (p) => pct(p.respondidos, p.entradas),
    fmt: fmtPct,
  },
  {
    key: "tempo",
    nome: "Tempo médio de resposta",
    cor: "hsl(25 85% 55%)",
    valor: (p) => p.tempoMedioSeg,
    fmt: fmtDuracao,
  },
  {
    key: "cancelamentos",
    nome: "Cancelamentos",
    cor: "hsl(0 70% 55%)",
    valor: (p) => p.cancelamentos,
    fmt: (v) => String(Math.round(v)),
    inicial: true,
  },
  {
    key: "cancelamentosPct",
    nome: "Cancelamentos (%)",
    cor: "hsl(0 50% 70%)",
    valor: (p) => pct(p.cancelamentos, p.entradas),
    fmt: fmtPct,
  },
];

const W = 760;
const H = 260;
const PAD = { top: 16, right: 12, bottom: 28, left: 12 };

export default function EvolutionChart({
  serie,
  periodo,
}: {
  serie: Ponto[];
  periodo: Periodo;
}) {
  const [ativas, setAtivas] = useState<Set<SerieKey>>(
    new Set(SERIES.filter((s) => s.inicial).map((s) => s.key)),
  );
  const [hover, setHover] = useState<number | null>(null);

  const totalEntradas = serie.reduce((s, p) => s + p.entradas, 0);

  function toggle(k: SerieKey) {
    setAtivas((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (serie.length <= 1 ? innerW / 2 : (i / (serie.length - 1)) * innerW);

  // Cada série normaliza pelo próprio máximo: é o que permite volume, % e
  // tempo dividirem a mesma área sem uma esmagar as outras.
  const valores = new Map<SerieKey, number[]>();
  const maximos = new Map<SerieKey, number>();
  for (const s of SERIES) {
    const vs = serie.map((p) => s.valor(p, totalEntradas));
    valores.set(s.key, vs);
    maximos.set(s.key, Math.max(...vs, 0) || 1);
  }

  const y = (k: SerieKey, v: number) =>
    PAD.top + innerH - (v / maximos.get(k)!) * innerH;

  const pontoHover = hover !== null ? serie[hover] : null;

  return (
    <div className="chart-wrap">
      <div className="card pad chart-card">
        {serie.every((p) => p.entradas === 0) ? (
          <div className="empty">Sem dados no período.</div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="chart-svg"
              role="img"
              aria-label="Evolução dos indicadores"
            >
              {/* Linhas de grade horizontais */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <line
                  key={f}
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={PAD.top + innerH * f}
                  y2={PAD.top + innerH * f}
                  stroke="hsl(220 20% 90%)"
                  strokeWidth="1"
                />
              ))}

              {SERIES.filter((s) => ativas.has(s.key)).map((s) => {
                const vs = valores.get(s.key)!;
                const d = vs
                  .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(s.key, v)}`)
                  .join(" ");
                return (
                  <g key={s.key}>
                    <path d={d} fill="none" stroke={s.cor} strokeWidth="2.5" />
                    {vs.map((v, i) => (
                      <circle
                        key={i}
                        cx={x(i)}
                        cy={y(s.key, v)}
                        r={hover === i ? 4.5 : 3}
                        fill={s.cor}
                      />
                    ))}
                  </g>
                );
              })}

              {/* Faixas invisíveis capturam o hover de cada período */}
              {serie.map((_, i) => (
                <rect
                  key={i}
                  x={x(i) - innerW / (serie.length * 2)}
                  y={PAD.top}
                  width={innerW / serie.length}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}

              {hover !== null && (
                <line
                  x1={x(hover)}
                  x2={x(hover)}
                  y1={PAD.top}
                  y2={PAD.top + innerH}
                  stroke="hsl(222 30% 70%)"
                  strokeDasharray="3 3"
                />
              )}

              {serie.map((p, i) => (
                <text
                  key={p.bucket}
                  x={x(i)}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="hsl(220 12% 46%)"
                >
                  {fmtBucket(p.bucket, periodo)}
                </text>
              ))}
            </svg>

            <div className="chart-tooltip">
              {pontoHover ? (
                <>
                  <strong>{fmtBucket(pontoHover.bucket, periodo)}</strong>
                  {SERIES.filter((s) => ativas.has(s.key)).map((s) => (
                    <span key={s.key}>
                      <i style={{ background: s.cor }} />
                      {s.nome}:{" "}
                      <strong>
                        {s.fmt(s.valor(pontoHover, totalEntradas))}
                      </strong>
                    </span>
                  ))}
                </>
              ) : (
                <span className="hint">
                  Passe o cursor sobre o gráfico para ver os valores reais de
                  cada período.
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Painel de indicadores */}
      <div className="card pad">
        <div className="card-title" style={{ marginBottom: 12 }}>
          Indicadores
        </div>
        {SERIES.map((s) => {
          const ultimo = serie[serie.length - 1];
          return (
            <label className="check serie-item" key={s.key}>
              <input
                type="checkbox"
                checked={ativas.has(s.key)}
                onChange={() => toggle(s.key)}
              />
              <i style={{ background: s.cor }} />
              <span>{s.nome}</span>
              <strong>
                {ultimo ? s.fmt(s.valor(ultimo, totalEntradas)) : "—"}
              </strong>
            </label>
          );
        })}
      </div>
    </div>
  );
}
