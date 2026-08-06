import { asc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { macros, mailboxes } from "@/db/schema";
import AppShell from "@/app/_components/AppShell";
import MacroManager from "./_components/MacroManager";

export const dynamic = "force-dynamic";

type SP = { caixa?: string };

/** Nome de exibição da caixa: operação quando existe, senão o rótulo. */
const MAILBOX_NAME = sql<string>`coalesce(nullif(${mailboxes.operation}, ''), ${mailboxes.label})`;

export default async function MacrosPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const rawCaixa = Number(sp.caixa);
  const caixaId = Number.isInteger(rawCaixa) && rawCaixa > 0 ? rawCaixa : null;

  const mbList = await db
    .select({ id: mailboxes.id, nome: MAILBOX_NAME })
    .from(mailboxes)
    .orderBy(asc(mailboxes.label));

  // Filtrar por uma caixa também traz as respostas sem caixa: elas são o
  // legado de antes da segmentação e valem para todas as operações.
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
        ? or(eq(macros.mailboxId, caixaId), isNull(macros.mailboxId))
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
              {caixaAtual ? ` em ${caixaAtual}` : ""}.
            </p>
          </div>
        </div>

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
