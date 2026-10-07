import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { contactReviews, mailboxes, messages, threads } from "@/db/schema";
import { excerptAround, findCancelTerms } from "@/lib/cancel-terms";

/**
 * Lista de contatos para a tela de cancelamentos.
 *
 * Lê as mensagens RECEBIDAS da janela pedida, procura os termos de triagem no
 * texto que o cliente escreveu (sem a citação) e agrupa por contato dentro
 * de cada caixa — o descadastramento na Everinbox é por projeto da caixa,
 * então o mesmo e-mail em duas operações são dois itens.
 *
 * A busca é feita aqui, não no SQL: a tolerância a erro de digitação não
 * cabe num LIKE. Para caber na memória, só o começo de cada corpo entra
 * (quem pede cancelamento diz isso nas primeiras linhas) e as mensagens são
 * lidas em lotes, das mais novas para as mais antigas, sem teto de
 * quantidade. O único limite é de tempo, para a função não ser derrubada
 * pelo Vercel no meio — e quando ele bate a tela avisa.
 */

export const WINDOW_OPTIONS = [7, 30, 90, 0] as const; // 0 = sem limite
export const DEFAULT_WINDOW_DAYS = 30;
const BATCH = 2000;
const BODY_PREFIX = 3000;
// Abaixo do maxDuration da página (60s), com folga para as consultas finais.
const TIME_BUDGET_MS = 45_000;

export type FlaggedContact = {
  /** Chave estável para seleção: `${mailboxId}:${email}`. */
  key: string;
  mailboxId: number;
  mailboxName: string;
  /** Caixa ligada a pelo menos um projeto da Everinbox. */
  projectLinked: boolean;
  email: string;
  /** Rótulos dos termos encontrados, sem repetição. */
  terms: string[];
  /** Palavras exatamente como o cliente escreveu ("cansela", "procom"). */
  words: string[];
  /** Mensagens que casaram. */
  hits: number;
  /** Mensagem mais recente que casou — é o que a decisão do agente cobre. */
  lastMessageId: number;
  lastThreadId: number;
  lastSubject: string | null;
  lastAt: Date | null;
  excerpt: string;
  /** Decisão anterior, se houver (o contato voltou por ter escrito de novo). */
  previous: { status: string; reviewedAt: Date } | null;
  /** Já tratado e sem mensagem nova — só aparece com "incluir tratados". */
  handled: boolean;
};

export type FlaggedResult = {
  contacts: FlaggedContact[];
  scanned: number;
  /** A varredura parou por tempo: as mensagens mais antigas ficaram de fora. */
  truncated: boolean;
};

export async function listFlaggedContacts(params: {
  windowDays: number;
  mailboxId: number | null;
  includeHandled: boolean;
}): Promise<FlaggedResult> {
  const { windowDays, mailboxId, includeHandled } = params;

  const conditions = [
    eq(messages.direction, "inbound"),
    isNotNull(messages.bodyText),
    isNotNull(threads.customerAddr),
  ];
  if (windowDays > 0) {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    conditions.push(gte(messages.createdAt, since));
  }
  if (mailboxId) conditions.push(eq(messages.mailboxId, mailboxId));

  const startedAt = Date.now();
  const groups = new Map<string, FlaggedContact>();
  let scanned = 0;
  let truncated = false;
  let lastId: number | null = null;

  for (;;) {
    const rows = await db
      .select({
        id: messages.id,
        threadId: messages.threadId,
        mailboxId: messages.mailboxId,
        subject: messages.subject,
        body: sql<string>`left(${messages.bodyText}, ${BODY_PREFIX})`,
        sentAt: messages.sentAt,
        createdAt: messages.createdAt,
        customerAddr: threads.customerAddr,
        mailboxName: sql<string>`coalesce(nullif(${mailboxes.operation}, ''), ${mailboxes.label})`,
        projectIds: mailboxes.everinboxProjectIds,
      })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .innerJoin(mailboxes, eq(mailboxes.id, messages.mailboxId))
      .where(
        and(
          ...conditions,
          lastId === null ? undefined : lt(messages.id, lastId),
        ),
      )
      .orderBy(desc(messages.id))
      .limit(BATCH);

    scanned += rows.length;
    if (rows.length > 0) lastId = rows[rows.length - 1].id;

    for (const r of rows) {
      const hits = findCancelTerms(r.body);
      if (hits.length === 0) continue;

      const email = r.customerAddr!.trim().toLowerCase();
      const key = `${r.mailboxId}:${email}`;
      const existing = groups.get(key);

      if (existing) {
        // As linhas vêm da mais nova para a mais antiga: a primeira já fixou
        // "última mensagem" e trecho; as seguintes só somam termos e contagem.
        existing.hits += 1;
        for (const h of hits) {
          if (!existing.terms.includes(h.term.label))
            existing.terms.push(h.term.label);
          if (!existing.words.includes(h.word)) existing.words.push(h.word);
        }
        continue;
      }

      groups.set(key, {
        key,
        mailboxId: r.mailboxId,
        mailboxName: r.mailboxName,
        projectLinked: Boolean(r.projectIds?.trim()),
        email,
        terms: hits.map((h) => h.term.label),
        words: hits.map((h) => h.word),
        hits: 1,
        lastMessageId: r.id,
        lastThreadId: r.threadId,
        lastSubject: r.subject,
        lastAt: r.sentAt ?? r.createdAt,
        excerpt: excerptAround(r.body, hits[0]),
        previous: null,
        handled: false,
      });
    }

    if (rows.length < BATCH) break;
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      truncated = true;
      break;
    }
  }

  // Decisões já tomadas. Uma consulta só, filtrada pelas caixas da lista.
  const mailboxIds = [...new Set([...groups.values()].map((g) => g.mailboxId))];
  const reviews =
    mailboxIds.length === 0
      ? []
      : await db
          .select()
          .from(contactReviews)
          .where(inArray(contactReviews.mailboxId, mailboxIds));

  for (const rv of reviews) {
    const g = groups.get(`${rv.mailboxId}:${rv.email}`);
    if (!g) continue;
    g.previous = { status: rv.status, reviewedAt: rv.reviewedAt };
    // Tratado = a decisão cobre a mensagem mais recente. Mensagem nova
    // depois da decisão traz o contato de volta, com a decisão anterior à vista.
    g.handled = rv.lastMessageId >= g.lastMessageId;
  }

  const contacts = [...groups.values()].filter(
    (g) => includeHandled || !g.handled,
  );

  return { contacts, scanned, truncated };
}
