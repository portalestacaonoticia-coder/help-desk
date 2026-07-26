import { and, eq, desc, asc, isNull, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  aiActions,
  aiSettings,
  categories,
  knowledgeBase,
  messages,
  threads,
  type AiSettings,
  type KbArticle,
} from "@/db/schema";
import { chatJson, DeepSeekError, isAiConfigured, DEFAULT_MODEL } from "@/lib/deepseek";

/** Prompt base usado enquanto a equipe não escrever o seu na tela da KB. */
export const DEFAULT_BASE_PROMPT = `Você é um agente de suporte da Tihee respondendo e-mails de clientes internos.

Regras de resposta:
- Escreva em português do Brasil, em tom cordial, direto e profissional.
- Responda SOMENTE com base nos artigos da base de conhecimento fornecidos.
- Se os artigos não cobrirem o problema, não invente solução: diga que vai
  verificar com o time e marque que precisa de um humano.
- Nunca prometa prazo, valor, reembolso ou exceção contratual.
- Nunca peça senha, token ou dado de cartão.
- Vá direto ao ponto: no máximo 3 parágrafos curtos.
- Não repita o texto do e-mail do cliente de volta.`;

const MAX_ARTICLES = 6;
const MAX_ARTICLE_CHARS = 1500;
const MAX_EMAIL_CHARS = 4000;
const MAX_HISTORY_MESSAGES = 6;

export type Suggestion = {
  categoria: string | null;
  confianca: number;
  resumo: string;
  resposta: string;
  artigos_usados: number[];
  precisa_humano: boolean;
};

/** Carrega (criando na primeira vez) a linha única de configuração da IA. */
export async function getAiSettings(): Promise<AiSettings> {
  const [existing] = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, 1))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(aiSettings)
    .values({ id: 1, basePrompt: DEFAULT_BASE_PROMPT })
    .onConflictDoNothing()
    .returning();

  // Corrida entre duas requisições: se o insert não retornou, alguém criou antes.
  if (created) return created;
  const [row] = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.id, 1))
    .limit(1);
  if (!row) {
    throw new Error(
      "Não foi possível carregar ai_settings — rode `npm run db:migrate`.",
    );
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* Seleção dos artigos relevantes                                      */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "a", "as", "o", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na",
  "nos", "nas", "um", "uma", "para", "por", "com", "que", "se", "ao", "aos",
  "mas", "ou", "the", "of", "to", "is", "it", "meu", "minha", "voces", "voce",
  "esta", "este", "isso", "nao", "sim", "ja", "bom", "dia", "boa", "tarde",
  "noite", "obrigado", "obrigada", "favor", "poderia", "gostaria", "quando",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

/**
 * Ranqueia os artigos por sobreposição de termos com o e-mail.
 * Busca lexical simples — sem embeddings, o que mantém o custo em zero e
 * funciona bem para uma KB interna de poucas centenas de artigos.
 */
export function rankArticles(
  emailText: string,
  articles: KbArticle[],
  limit = MAX_ARTICLES,
): KbArticle[] {
  const terms = new Set(tokenize(emailText));
  if (terms.size === 0) return articles.slice(0, limit);

  const scored = articles.map((article) => {
    const title = tokenize(article.title ?? "");
    const keywords = tokenize(article.keywords ?? "");
    const body = tokenize(article.content ?? "");

    let score = 0;
    // Título e palavras-chave pesam mais que o corpo.
    for (const t of new Set(title)) if (terms.has(t)) score += 3;
    for (const t of new Set(keywords)) if (terms.has(t)) score += 4;
    for (const t of new Set(body)) if (terms.has(t)) score += 1;

    return { article, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.article);
}

function truncate(text: string | null, max: number): string {
  const s = (text ?? "").trim();
  return s.length > max ? `${s.slice(0, max)}\n[…truncado]` : s;
}

/* ------------------------------------------------------------------ */
/* Montagem do prompt                                                  */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(
  settings: AiSettings,
  cats: Array<{ name: string; description: string | null }>,
  articles: KbArticle[],
): string {
  const base = settings.basePrompt.trim() || DEFAULT_BASE_PROMPT;

  const categoryBlock = cats.length
    ? cats
        .map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`)
        .join("\n")
    : "(nenhuma categoria cadastrada — devolva categoria null)";

  const kbBlock = articles.length
    ? articles
        .map(
          (a) =>
            `### Artigo ${a.id} — ${a.title ?? "(sem título)"}\n${truncate(a.content, MAX_ARTICLE_CHARS)}`,
        )
        .join("\n\n")
    : "(nenhum artigo relevante encontrado na base)";

  return `${base}

## Categorias disponíveis
${categoryBlock}

## Base de conhecimento
${kbBlock}

## Formato de saída
Responda APENAS com um objeto json neste formato exato:
{
  "categoria": "nome exato de uma das categorias acima, ou null",
  "confianca": 0.0,
  "resumo": "uma frase sobre o que o cliente precisa",
  "resposta": "o e-mail de resposta ao cliente, sem assinatura",
  "artigos_usados": [1, 2],
  "precisa_humano": false
}

"confianca" é um número entre 0 e 1 indicando o quanto você tem certeza de que
a resposta resolve o problema com base nos artigos acima. Use "precisa_humano":
true sempre que os artigos não cobrirem o caso, o cliente estiver irritado, ou o
pedido envolver exceção, prazo, valor ou acesso privilegiado.`;
}

function buildUserPrompt(
  subject: string | null,
  history: Array<{ direction: string; fromAddr: string | null; bodyText: string | null }>,
): string {
  const thread = history
    .map((m) => {
      const who = m.direction === "outbound" ? "SUPORTE" : "CLIENTE";
      return `[${who} — ${m.fromAddr ?? "?"}]\n${truncate(m.bodyText, MAX_EMAIL_CHARS)}`;
    })
    .join("\n\n---\n\n");

  return `Assunto: ${subject ?? "(sem assunto)"}

${thread}

Analise a última mensagem do CLIENTE e devolve o json de resposta.`;
}

/* ------------------------------------------------------------------ */
/* Geração da sugestão                                                 */
/* ------------------------------------------------------------------ */

function normalizeSuggestion(raw: unknown): Suggestion {
  const o = (raw ?? {}) as Record<string, unknown>;
  const confRaw = Number(o.confianca);

  return {
    categoria:
      typeof o.categoria === "string" && o.categoria.trim() ? o.categoria.trim() : null,
    // Modelo às vezes devolve 0-100 em vez de 0-1.
    confianca: Number.isFinite(confRaw)
      ? Math.min(1, Math.max(0, confRaw > 1 ? confRaw / 100 : confRaw))
      : 0,
    resumo: typeof o.resumo === "string" ? o.resumo.trim() : "",
    resposta: typeof o.resposta === "string" ? o.resposta.trim() : "",
    artigos_usados: Array.isArray(o.artigos_usados)
      ? o.artigos_usados.map(Number).filter(Number.isInteger)
      : [],
    precisa_humano: o.precisa_humano === true,
  };
}

/**
 * Gera um rascunho de resposta para a última mensagem recebida de uma thread
 * e grava o resultado em `ai_actions`.
 *
 * Sempre rascunho: esta função NUNCA envia e-mail. O envio continua sendo um
 * clique do agente, mesmo quando a categoria é auto-respondível.
 */
export async function suggestReplyForMessage(messageId: number): Promise<{
  ok: boolean;
  error?: string;
}> {
  const [msg] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!msg) return { ok: false, error: "Mensagem não encontrada" };
  if (msg.direction !== "inbound") {
    return { ok: false, error: "Só mensagens recebidas são analisadas" };
  }

  const settings = await getAiSettings();
  if (!settings.enabled) return { ok: false, error: "IA desativada nas configurações" };
  if (!isAiConfigured()) return { ok: false, error: "DEEPSEEK_API_KEY não configurada" };

  const [thread] = await db
    .select()
    .from(threads)
    .where(eq(threads.id, msg.threadId))
    .limit(1);

  // Histórico recente da thread, para a IA entender o contexto da conversa.
  const history = await db
    .select({
      direction: messages.direction,
      fromAddr: messages.fromAddr,
      bodyText: messages.bodyText,
    })
    .from(messages)
    .where(eq(messages.threadId, msg.threadId))
    .orderBy(desc(messages.createdAt))
    .limit(MAX_HISTORY_MESSAGES);
  history.reverse();

  const cats = await db
    .select({ name: categories.name, description: categories.description })
    .from(categories)
    .where(eq(categories.active, true))
    .orderBy(asc(categories.name));

  const allArticles = await db
    .select()
    .from(knowledgeBase)
    .where(eq(knowledgeBase.active, true));

  const haystack = `${thread?.subject ?? ""} ${msg.bodyText ?? ""}`;
  const relevant = rankArticles(haystack, allArticles);

  const system = buildSystemPrompt(settings, cats, relevant);
  const user = buildUserPrompt(thread?.subject ?? msg.subject, history);

  try {
    const result = await chatJson<unknown>(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      {
        model: settings.model || DEFAULT_MODEL,
        temperature: settings.temperature,
      },
    );

    const s = normalizeSuggestion(result.data);

    // Categoria só é aceita se existir de fato, passar do limiar e o modelo não
    // ter sinalizado que o caso precisa de um humano.
    const known = cats.find(
      (c) => c.name.toLowerCase() === (s.categoria ?? "").toLowerCase(),
    );
    const categoria =
      known && !s.precisa_humano && s.confianca >= settings.confidenceThreshold
        ? known.name
        : null;

    // Sinalizar "precisa humano" derruba a confiança exibida ao agente, para o
    // card não passar segurança que o próprio modelo disse não ter.
    const confianca = s.precisa_humano ? Math.min(s.confianca, 0.4) : s.confianca;

    await db
      .insert(aiActions)
      .values({
        messageId: msg.id,
        threadId: msg.threadId,
        categorySuggested: categoria,
        confidence: confianca,
        actionTaken: "sugerido",
        responseSent: s.resposta,
        summary: s.resumo,
        sourceArticleIds: s.artigos_usados.join(","),
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        status: "pendente",
      })
      .onConflictDoNothing();

    // Grava a categoria na thread quando ela ainda não tem uma.
    if (categoria && thread && !thread.category) {
      await db
        .update(threads)
        .set({ category: categoria })
        .where(eq(threads.id, thread.id));
    }

    return { ok: true };
  } catch (err) {
    const message =
      err instanceof DeepSeekError || err instanceof Error
        ? err.message
        : String(err);

    // Registra a falha para não reprocessar em loop e para aparecer no painel.
    await db
      .insert(aiActions)
      .values({
        messageId: msg.id,
        threadId: msg.threadId,
        actionTaken: "erro",
        errorMessage: message.slice(0, 1000),
        model: settings.model,
        status: "pendente",
      })
      .onConflictDoNothing();

    return { ok: false, error: message };
  }
}

/**
 * Analisa as mensagens recebidas que ainda não passaram pela IA.
 * Chamado pelo cron logo após a ingestão IMAP.
 */
export async function processPendingMessages(limit = 20): Promise<{
  processed: number;
  failed: number;
  skipped?: string;
}> {
  const settings = await getAiSettings();
  if (!settings.enabled) return { processed: 0, failed: 0, skipped: "IA desativada" };
  if (!isAiConfigured()) {
    return { processed: 0, failed: 0, skipped: "DEEPSEEK_API_KEY não configurada" };
  }

  // Mensagens inbound sem linha correspondente em ai_actions.
  const pending = await db
    .select({ id: messages.id })
    .from(messages)
    .leftJoin(aiActions, eq(aiActions.messageId, messages.id))
    .where(and(eq(messages.direction, "inbound"), isNull(aiActions.id)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  let processed = 0;
  let failed = 0;
  for (const m of pending) {
    const result = await suggestReplyForMessage(m.id);
    if (result.ok) processed++;
    else failed++;
  }

  return { processed, failed };
}

/** Rascunho pendente mais recente de uma thread, para exibir no chamado. */
export async function getLatestSuggestion(threadId: number) {
  const [row] = await db
    .select()
    .from(aiActions)
    .where(and(eq(aiActions.threadId, threadId), eq(aiActions.status, "pendente")))
    .orderBy(desc(aiActions.createdAt))
    .limit(1);
  return row ?? null;
}

/** Artigos citados por uma sugestão, para mostrar as fontes no card. */
export async function getSuggestionSources(sourceArticleIds: string | null) {
  const ids = (sourceArticleIds ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isInteger);
  if (ids.length === 0) return [];

  return db
    .select({ id: knowledgeBase.id, title: knowledgeBase.title })
    .from(knowledgeBase)
    .where(inArray(knowledgeBase.id, ids));
}
