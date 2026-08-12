import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { macros, mailboxes } from "@/db/schema";
import AppShell from "@/app/_components/AppShell";
import MacroManager from "./_components/MacroManager";

export const dynamic = "force-dynamic";

type SP = { caixa?: string };

/** Nome de exibição da caixa: operação quando existe, senão o rótulo. */
const MAILBOX_NAME = sql<string>`coalesce(nullif(${mailboxes.operation}, ''), ${mailboxes.label})`;

/** Valor do filtro que isola as respostas legadas, sem caixa atribuída. */
const SEM_CAIXA = "sem-caixa";

export default async function MacrosPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const rawCaixa = Number(sp.caixa);
  const caixaId = Number.isInteger(rawCaixa) && rawCaixa > 0 ? rawCaixa : null;
  const soSemCaixa = sp.caixa === SEM_CAIXA;

  const mbList = await db
    .select({ id: mailboxes.id, nome: MAILBOX_NAME })
    .from(mailboxes)
    .orderBy(asc(mailboxes.label));

  // Respostas legadas, de antes da segmentação: ficaram sem caixa e por isso
  // não aparecem mais no atendimento. Contadas para avisar quem precisa
  // resolver — atribuindo uma caixa ou removendo.
  const [{ n: semCaixa }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(macros)
    .where(isNull(macros.mailboxId));

  // Filtro estrito: cada resposta pertence a uma caixa só, e o texto de uma
  // marca não serve para outra.
  const list = await db
    .select({
      id: macros.id,
      title: macros.title,
      body: macros.body,
      shortcut: macros.shortcut,
      mailboxId: macros.mailboxId,
      mailboxName: sql<string | null>`${MAILBOX_NAME}`,
    })
    .from(macros)
    .leftJoin(mailboxes, eq(mailboxes.id, macros.mailboxId))
    .where(
      caixaId
        ? eq(macros.mailboxId, caixaId)
        : soSemCaixa
          ? isNull(macros.mailboxId)
          : undefined,
    )
    .orderBy(sql`${MAILBOX_NAME} asc nulls first`, asc(macros.title));

  const caixaAtual = caixaId
    ? (mbList.find((m) => m.id === caixaId)?.nome ?? null)
    : null;

  return (
    <AppShell>
      <section className="page">
        <div className="page-head">
          <div>
            <h1>Respostas prontas</h1>
            <p className="page-sub">
              {list.length} resposta{list.length === 1 ? "" : "s"} pronta
              {list.length === 1 ? "" : "s"} disponíve
              {list.length === 1 ? "l" : "is"} para o time no atendimento
              {caixaAtual ? ` em ${caixaAtual}` : ""}
              {soSemCaixa ? " — sem caixa atribuída" : ""}.
            </p>
          </div>
        </div>

        {semCaixa > 0 && (
          <div className="callout warn">
            {semCaixa} resposta{semCaixa === 1 ? "" : "s"} sem caixa de entrada.
            {semCaixa === 1 ? " Ela não aparece" : " Elas não aparecem"} no
            atendimento — edite para atribuir uma caixa, ou remova.
          </div>
        )}

        <form className="filters" method="get">
          <div>
            <label htmlFor="f-caixa">Filtrar por caixa de entrada</label>
            <select id="f-caixa" name="caixa" defaultValue={sp.caixa ?? ""}>
              <option value="">Todas as caixas</option>
              {mbList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
              {/* Só faz sentido oferecer o filtro quando há o que resolver —
                  mas mantido enquanto ele estiver ligado, senão o select
                  mostra "Todas as caixas" sobre uma lista filtrada. */}
              {(semCaixa > 0 || soSemCaixa) && (
                <option value={SEM_CAIXA}>Sem caixa</option>
              )}
            </select>
          </div>
          <div>
            <button type="submit" className="primary">
              Filtrar
            </button>
          </div>
        </form>

        <MacroManager
          macros={list}
          mailboxes={mbList}
          // Criar com o filtro ligado já vem na caixa que o agente está vendo.
          defaultMailboxId={caixaId}
        />
      </section>
    </AppShell>
  );
}
