import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { mailboxes } from "@/db/schema";
import AppShell from "@/app/_components/AppShell";
import { CANCEL_TERMS } from "@/lib/cancel-terms";
import {
  DEFAULT_WINDOW_DAYS,
  WINDOW_OPTIONS,
  listFlaggedContacts,
} from "@/lib/cancel-review";
import { isEverinboxConfigured } from "@/lib/everinbox";
import CancelReviewTable from "./_components/CancelReviewTable";

export const dynamic = "force-dynamic";
// A varredura lê todas as mensagens do período; "Todo o período" pode passar
// dos 10s padrão do Vercel.
export const maxDuration = 60;

type SP = { dias?: string; caixa?: string; tratados?: string };

const WINDOW_LABELS: Record<number, string> = {
  7: "Últimos 7 dias",
  30: "Últimos 30 dias",
  90: "Últimos 90 dias",
  0: "Todo o período",
};

/**
 * Triagem de cancelamentos.
 *
 * Reúne os contatos que escreveram "cancelar", "Procon", "advogado"… nas
 * mensagens recebidas. NADA é cancelado sozinho: o agente seleciona e
 * descadastra na Everinbox, ou marca como ignorado.
 */
export default async function CancelamentosPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;

  const diasRaw = Number(sp.dias);
  const windowDays = (WINDOW_OPTIONS as readonly number[]).includes(diasRaw)
    ? diasRaw
    : DEFAULT_WINDOW_DAYS;
  const caixaRaw = Number(sp.caixa);
  const mailboxId = Number.isInteger(caixaRaw) && caixaRaw > 0 ? caixaRaw : null;
  const includeHandled = sp.tratados === "1";

  const mbList = await db
    .select({
      id: mailboxes.id,
      nome: sql<string>`coalesce(nullif(${mailboxes.operation}, ''), ${mailboxes.label})`,
    })
    .from(mailboxes)
    .orderBy(asc(mailboxes.label));

  const { contacts, scanned, truncated } = await listFlaggedContacts({
    windowDays,
    mailboxId,
    includeHandled,
  });

  const pendentes = contacts.filter((c) => !c.handled).length;
  const everinboxOk = isEverinboxConfigured();

  return (
    <AppShell mailbox={mailboxId ? String(mailboxId) : undefined}>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Cancelamentos</h1>
            <p className="page-sub">
              {pendentes === 0
                ? "Nenhum contato aguardando decisão"
                : `${pendentes} contato${pendentes === 1 ? "" : "s"} aguardando decisão`}
              {" · "}
              {WINDOW_LABELS[windowDays].toLowerCase()}
              {" · "}
              {scanned === 1
                ? "1 mensagem analisada"
                : `${scanned} mensagens analisadas`}
              . Nada é cancelado sozinho: quem decide é você.
            </p>
          </div>
        </div>

        {!everinboxOk && (
          <div className="callout warn">
            <strong>Everinbox não configurada.</strong> Defina{" "}
            <span className="mono">EVERINBOX_API_KEY</span> no ambiente para o
            botão de cancelar inscrição funcionar. A lista continua visível.
          </div>
        )}

        {truncated && (
          <div className="callout warn">
            A análise parou por tempo depois de {scanned} mensagens — as mais
            antigas ficaram de fora. Reduza o período ou filtre por caixa para
            garantir que nenhum contato escapou.
          </div>
        )}

        <div className="callout">
          Entram aqui as mensagens recebidas que contêm{" "}
          {CANCEL_TERMS.map((t) => t.label).join(", ")} e variações com erro de
          digitação (cansela, procom, adivogado…). O texto citado da nossa
          resposta anterior é ignorado.
        </div>

        <form className="filters" method="get">
          <div>
            <label htmlFor="f-dias">Período</label>
            <select id="f-dias" name="dias" defaultValue={String(windowDays)}>
              {WINDOW_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {WINDOW_LABELS[d]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-caixa">Operação</label>
            <select id="f-caixa" name="caixa" defaultValue={sp.caixa ?? ""}>
              <option value="">Todas</option>
              {mbList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-tratados">Já tratados</label>
            <select id="f-tratados" name="tratados" defaultValue={includeHandled ? "1" : ""}>
              <option value="">Esconder</option>
              <option value="1">Mostrar</option>
            </select>
          </div>
          <div>
            <button type="submit" className="primary">
              Filtrar
            </button>
          </div>
        </form>

        <CancelReviewTable contacts={contacts} everinboxOk={everinboxOk} />
      </section>
    </AppShell>
  );
}
