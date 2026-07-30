import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { mailboxes } from "@/db/schema";
import AppShell from "@/app/_components/AppShell";
import EvolutionChart from "./_components/EvolutionChart";
import {
  getDashboard,
  gerarAlertas,
  isPeriodo,
  fmtDuracao,
  fmtPct,
  pct,
  variacao,
  PERIODO_LABEL,
  type Periodo,
} from "@/lib/dashboard";

export const dynamic = "force-dynamic";

type SP = { periodo?: string; conta?: string };

/** Variação vs período anterior. Sobe é bom, menos para tempo e cancelamento. */
function Delta({ v, inverso = false }: { v: number | null; inverso?: boolean }) {
  if (v === null) return <span className="kpi-delta neutro">sem base anterior</span>;
  const bom = inverso ? v <= 0 : v >= 0;
  const sinal = v > 0 ? "+" : "";
  return (
    <span className={`kpi-delta ${bom ? "bom" : "ruim"}`}>
      {sinal}
      {v.toFixed(1).replace(".", ",")}% vs período anterior
    </span>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const periodo: Periodo =
    sp.periodo && isPeriodo(sp.periodo) ? sp.periodo : "semana";
  const contaId = sp.conta ? Number(sp.conta) : null;

  const contasDisponiveis = await db
    .select({
      id: mailboxes.id,
      nome: sql<string>`coalesce(nullif(${mailboxes.operation}, ''), ${mailboxes.label})`,
    })
    .from(mailboxes)
    .where(eq(mailboxes.active, true))
    .orderBy(asc(mailboxes.label));

  const d = await getDashboard(periodo, contaId);
  const alertas = gerarAlertas(d);

  const { atual, anterior, diasNoPeriodo } = d;
  const totalEntradasContas = d.contas.reduce((s, c) => s + c.entradas, 0);

  function href(next: Partial<SP>) {
    const params = new URLSearchParams();
    const merged = { periodo: sp.periodo, conta: sp.conta, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/dashboard?${qs}` : "/dashboard";
  }

  const media = (n: number) => (n / diasNoPeriodo).toFixed(1).replace(".", ",");

  return (
    <AppShell mailbox={sp.conta}>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Dashboard</h1>
          </div>
        </div>

        {/* ---- 1. Filtros globais ---- */}
        <div className="filters">
          <div>
            <label>Período</label>
            <div className="segmented">
              {(Object.keys(PERIODO_LABEL) as Periodo[]).map((p) => (
                <Link
                  key={p}
                  href={href({ periodo: p })}
                  className={p === periodo ? "active" : ""}
                >
                  {PERIODO_LABEL[p]}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="f-conta">Conta</label>
            <form method="get" id="f-dash">
              <input type="hidden" name="periodo" value={periodo} />
              <select
                id="f-conta"
                name="conta"
                defaultValue={sp.conta ?? ""}
                // Sem JS de rota: o próprio submit recarrega com o filtro.
                form="f-dash"
              >
                <option value="">Todas as contas</option>
                {contasDisponiveis.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </form>
          </div>
          <div>
            <button type="submit" form="f-dash" className="primary">
              Aplicar
            </button>
          </div>
        </div>

        {/* ---- 2. KPIs ---- */}
        <div className="kpi-grid">
          <div className="card pad kpi">
            <span className="kpi-label">Caixa de entrada</span>
            <strong className="kpi-num">{atual.entradas}</strong>
            <span className="kpi-sub">{media(atual.entradas)} por dia</span>
            <Delta v={variacao(atual.entradas, anterior.entradas)} />
          </div>

          <div className="card pad kpi">
            <span className="kpi-label">E-mails respondidos</span>
            <strong className="kpi-num">{atual.respondidos}</strong>
            <span className="kpi-sub">
              {fmtPct(pct(atual.respondidos, atual.entradas))} do recebido ·{" "}
              {media(atual.respondidos)} por dia
            </span>
            <Delta v={variacao(atual.respondidos, anterior.respondidos)} />
          </div>

          <div className="card pad kpi">
            <span className="kpi-label">Tempo médio de resposta</span>
            <strong className="kpi-num">{fmtDuracao(atual.tempoMedioSeg)}</strong>
            <span className="kpi-sub">ponderado pelo volume respondido</span>
            <Delta
              v={variacao(atual.tempoMedioSeg, anterior.tempoMedioSeg)}
              inverso
            />
          </div>

          <div className="card pad kpi">
            <span className="kpi-label">Cancelamentos</span>
            <strong className="kpi-num">{atual.cancelamentos}</strong>
            <span className="kpi-sub">
              {fmtPct(pct(atual.cancelamentos, atual.entradas))} do recebido ·{" "}
              {media(atual.cancelamentos)} por dia
            </span>
            <Delta
              v={variacao(atual.cancelamentos, anterior.cancelamentos)}
              inverso
            />
          </div>
        </div>

        {/* ---- 3 e 4. Gráfico e painel de indicadores ---- */}
        <EvolutionChart serie={d.serie} periodo={periodo} />

        {/* ---- 5. Tabela comparativa ---- */}
        <div className="card table">
          <div className="trow thead dash-row">
            <div>Conta</div>
            <div>Entrada</div>
            <div>Entrada %</div>
            <div>Respondidos</div>
            <div>Resp. %</div>
            <div>Tempo médio</div>
            <div>Cancel.</div>
            <div>Cancel. %</div>
          </div>

          {d.contas.length === 0 ? (
            <div className="empty">Nenhum e-mail recebido no período.</div>
          ) : (
            <>
              {d.contas.map((c) => (
                <div className="trow dash-row" key={c.mailboxId}>
                  <div className="t-subject">{c.nome}</div>
                  <div>{c.entradas}</div>
                  <div>{fmtPct(pct(c.entradas, totalEntradasContas))}</div>
                  <div>{c.respondidos}</div>
                  <div>{fmtPct(pct(c.respondidos, c.entradas))}</div>
                  <div>{fmtDuracao(c.tempoMedioSeg)}</div>
                  <div>{c.cancelamentos}</div>
                  <div>{fmtPct(pct(c.cancelamentos, c.entradas))}</div>
                </div>
              ))}
              <div className="trow dash-row total">
                <div>
                  <strong>Total geral</strong>
                </div>
                <div>{atual.entradas}</div>
                <div>100,0%</div>
                <div>{atual.respondidos}</div>
                <div>{fmtPct(pct(atual.respondidos, atual.entradas))}</div>
                <div>{fmtDuracao(atual.tempoMedioSeg)}</div>
                <div>{atual.cancelamentos}</div>
                <div>{fmtPct(pct(atual.cancelamentos, atual.entradas))}</div>
              </div>
            </>
          )}
        </div>

        {/* ---- 6. Alertas ---- */}
        {alertas.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {alertas.map((a, i) => (
              <div key={i} className={`callout ${a.nivel}`}>
                {a.texto}
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
