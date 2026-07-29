import { and, eq, lt, or, isNotNull, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { threads, messages, aiActions, ingestLogs } from "@/db/schema";

/**
 * Limpeza periódica. O banco enche pelo corpo dos e-mails: 44 mil mensagens
 * ocupavam 471 MB, e o teto do Neon é 512 MB.
 *
 * Duas regras, ambas sobre `last_message_at` (a data real da conversa):
 *
 * 1. Resposta FECHADA há mais de 7 dias perde o corpo das mensagens, mas
 *    mantém a linha e a thread. O chamado continua na fila com assunto,
 *    contato, data e categoria — só o texto some. Isso evita o chamado
 *    "0 mensagens" que apagar a linha produziria.
 *
 * 2. Resposta classificada como "Sem Resposta" há mais de 7 dias é apagada
 *    de verdade. É ruído por definição.
 *
 * Nada que esteja ABERTO é tocado, por mais antigo que seja: idade não é
 * sinal de que alguém já tratou.
 */
export const RETENTION_DAYS = 7;

// Lotes pequenos: com o banco no teto, um UPDATE grande falha por não ter
// espaço para as versões novas das linhas.
const BATCH = 500;

// Abaixo do maxDuration da rota. Sobrando trabalho, a rodada de amanhã segue.
const TIME_BUDGET_MS = 40_000;

export type RetentionResult = {
  corposLimpos: number;
  threadsApagadas: number;
  concluido: boolean;
};

export async function runRetention(): Promise<RetentionResult> {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  let corposLimpos = 0;
  let threadsApagadas = 0;
  const expirou = () => Date.now() - startedAt > TIME_BUDGET_MS;

  // ---- 1. Corpo das mensagens de respostas fechadas ----
  while (!expirou()) {
    const alvo = await db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(
        and(
          eq(threads.status, "fechado"),
          lt(threads.lastMessageAt, cutoff),
          or(isNotNull(messages.bodyText), isNotNull(messages.bodyHtml)),
        ),
      )
      .limit(BATCH);
    if (alvo.length === 0) break;

    await db
      .update(messages)
      .set({ bodyText: null, bodyHtml: null })
      .where(
        inArray(
          messages.id,
          alvo.map((m) => m.id),
        ),
      );
    corposLimpos += alvo.length;
  }

  // ---- 2. Respostas "Sem Resposta" antigas, apagadas por completo ----
  while (!expirou()) {
    const alvo = await db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.category, "Sem Resposta"),
          lt(threads.lastMessageAt, cutoff),
        ),
      )
      .limit(BATCH);
    if (alvo.length === 0) break;

    const ids = alvo.map((t) => t.id);

    // Ordem ditada pelas FKs: ai_actions aponta para messages e para threads.
    const msgIds = (
      await db
        .select({ id: messages.id })
        .from(messages)
        .where(inArray(messages.threadId, ids))
    ).map((m) => m.id);

    if (msgIds.length > 0) {
      await db.delete(aiActions).where(inArray(aiActions.messageId, msgIds));
    }
    await db.delete(aiActions).where(inArray(aiActions.threadId, ids));
    await db.delete(messages).where(inArray(messages.threadId, ids));
    await db.delete(threads).where(inArray(threads.id, ids));

    threadsApagadas += ids.length;
  }

  const concluido = !expirou();

  // Log com mailbox_id nulo: a tela de caixas filtra por mailbox_id não nulo,
  // então a limpeza não se mistura ao histórico de ingestão de cada caixa.
  await db.insert(ingestLogs).values({
    mailboxId: null,
    status: "ok",
    fetched: corposLimpos + threadsApagadas,
    message: `retenção ${RETENTION_DAYS}d: ${corposLimpos} corpos limpos, ${threadsApagadas} respostas apagadas${concluido ? "" : " (parcial, continua amanhã)"}`,
    durationMs: Date.now() - startedAt,
  });

  return { corposLimpos, threadsApagadas, concluido };
}

export type CleanupFilter = {
  /** Idade mínima em dias. Sempre aplicada — evita apagar o movimento do dia. */
  dias: number;
  somenteFechadas: boolean;
  semResposta: boolean;
};

/** Monta o filtro compartilhado entre a contagem e a remoção. */
function cleanupWhere(f: CleanupFilter) {
  const cutoff = new Date(Date.now() - f.dias * 24 * 60 * 60 * 1000);
  const conds = [lt(threads.lastMessageAt, cutoff)];
  if (f.somenteFechadas) conds.push(eq(threads.status, "fechado"));
  if (f.semResposta) conds.push(eq(threads.category, "Sem Resposta"));
  return and(...conds);
}

/** Quantas respostas o filtro atinge. Mostrado antes de apagar. */
export async function countCleanup(f: CleanupFilter): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(threads)
    .where(cleanupWhere(f));
  return n;
}

/**
 * Remove as respostas que casam com o filtro, junto com suas mensagens e
 * análises da IA. DESTRUTIVO e sem desfazer.
 *
 * Em lotes por dois motivos: com o banco no teto, transação grande falha por
 * falta de espaço; e o orçamento de tempo impede estourar o limite da função.
 */
export async function runCleanup(f: CleanupFilter): Promise<{
  removidas: number;
  concluido: boolean;
}> {
  const startedAt = Date.now();
  let removidas = 0;

  while (Date.now() - startedAt <= TIME_BUDGET_MS) {
    const alvo = await db
      .select({ id: threads.id })
      .from(threads)
      .where(cleanupWhere(f))
      .limit(BATCH);
    if (alvo.length === 0) break;

    const ids = alvo.map((t) => t.id);
    const msgIds = (
      await db
        .select({ id: messages.id })
        .from(messages)
        .where(inArray(messages.threadId, ids))
    ).map((m) => m.id);

    // Ordem ditada pelas FKs.
    if (msgIds.length > 0) {
      await db.delete(aiActions).where(inArray(aiActions.messageId, msgIds));
    }
    await db.delete(aiActions).where(inArray(aiActions.threadId, ids));
    await db.delete(messages).where(inArray(messages.threadId, ids));
    await db.delete(threads).where(inArray(threads.id, ids));

    removidas += ids.length;
  }

  return {
    removidas,
    concluido: (await countCleanup(f)) === 0,
  };
}

/** Quanto ainda há para limpar. Usado para mostrar o pendente na tela. */
export async function retentionPending(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(threads, eq(threads.id, messages.threadId))
    .where(
      and(
        eq(threads.status, "fechado"),
        lt(threads.lastMessageAt, cutoff),
        or(isNotNull(messages.bodyText), isNotNull(messages.bodyHtml)),
      ),
    );
  return n;
}
