import { and, eq, desc, asc, isNull, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  aiActions,
  aiSettings,
  categories,
  knowledgeBase,
  mailboxes,
  messages,
  threads,
  type AiSettings,
  type KbArticle,
} from "@/db/schema";
import { chatJson, DeepSeekError, isAiConfigured, DEFAULT_MODEL } from "@/lib/deepseek";
import { sendReply } from "@/lib/smtp";

/** Prompt base usado enquanto a equipe não escrever o seu na tela da KB. */
export const DEFAULT_BASE_PROMPT = `Você é um agente de suporte da Tihee respondendo e-mails de clientes internos.

Regras de resposta:
- Escreva em português do Brasil, em tom cordial, direto e profissional.
- Responda SOMENTE com base nos artigos da base de conhecimento fornecidos.
- Se os artigos não cobrirem o problema, não invente solução: diga apenas que
  vai verificar com o time e retornar, e marque "precisa_humano": true.
- NUNCA mencione ao cliente que existe uma "base de conhecimento", "artigos" ou
  que você é uma IA — para ele, quem escreve é a equipe de suporte.
- Nunca prometa prazo, valor, reembolso ou exceção contratual.
- Nunca peça senha, token ou dado de cartão.
- Vá direto ao ponto: no máximo 3 parágrafos curtos.
- Não repita o texto do e-mail do cliente de volta.
- NÃO escreva despedida nem assinatura ("Atenciosamente", "Equipe de Suporte"):
  a assinatura é anexada automaticamente depois e sairia duplicada.`;

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
  /**
   * Liberação EXPLÍCITA para enviar sem revisão. Falta do campo, valor
   * diferente de `true` ou json malformado deixam isto `false` — a falha
   * empurra para o rascunho, nunca para o envio.
   */
  posso_enviar: boolean;
};

/**
 * Configuração usada quando as tabelas da IA ainda não existem no banco.
 * `enabled: false` porque sem migration não há onde gravar `ai_actions`.
 */
const FALLBACK_SETTINGS: AiSettings = {
  id: 1,
  enabled: false,
  model: DEFAULT_MODEL,
  basePrompt: DEFAULT_BASE_PROMPT,
  autoSendPrompt: "",
  autoSendEnabled: false,
  updatedAt: new Date(0),
};

/** Erro de tabela/coluna inexistente no Postgres (migration não aplicada). */
function isMissingRelation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  // 42P01 = undefined_table, 42703 = undefined_column
  return code === "42P01" || code === "42703";
}

/**
 * Igual a getAiSettings(), mas nunca lança: se as tabelas da IA não existem
 * ainda, devolve a configuração desligada.
 *
 * Existe para que ler e responder um chamado — o núcleo do produto — não
 * dependa da camada de IA estar migrada.
 */
export async function getAiSettingsSafe(): Promise<AiSettings> {
  try {
    return await getAiSettings();
  } catch (err) {
    if (isMissingRelation(err)) return FALLBACK_SETTINGS;
    throw err;
  }
}

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

  // Só entra quando a resposta vai de fato sair sem ninguém olhar.
  const autoBlock =
    settings.autoSendEnabled && settings.autoSendPrompt.trim()
      ? `\n\n## Envio automático (esta resposta vai ao cliente SEM revisão humana)\n${settings.autoSendPrompt.trim()}`
      : "";

  return `${base}${autoBlock}

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
  "resposta": "o corpo do e-mail, terminando na última frase útil — sem despedida e sem assinatura",
  "artigos_usados": [1, 2],
  "precisa_humano": false,
  "posso_enviar": false
}

"confianca" é um número entre 0 e 1 indicando o quanto você tem certeza de que
a resposta resolve o problema com base nos artigos acima. Use "precisa_humano":
true sempre que os artigos não cobrirem o caso, o cliente estiver irritado, ou o
pedido envolver exceção, prazo, valor ou acesso privilegiado.

"posso_enviar" é a sua liberação para esta resposta ir ao cliente SEM nenhuma
revisão humana. O padrão é false. Só marque true quando TODAS forem verdade:
o material acima cobre o caso por completo; a resposta não contém nada que você
tenha inferido ou suposto; não há valor, prazo, exceção ou dado de conta
envolvido; e você reenviaria essa mensagem exatamente assim se fosse o
responsável pela conta. Na menor hesitação, deixe false.`;
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
    // Comparação estrita de propósito: só um `true` literal libera. Campo
    // ausente, "true" como string ou 1 continuam barrando o envio.
    posso_enviar: o.posso_enviar === true,
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
      { model: settings.model || DEFAULT_MODEL },
    );

    const s = normalizeSuggestion(result.data);

    // Categoria só é aceita se existir de fato e o modelo não tiver sinalizado
    // que o caso precisa de um humano.
    const known = cats.find(
      (c) => c.name.toLowerCase() === (s.categoria ?? "").toLowerCase(),
    );
    const categoria = known && !s.precisa_humano ? known.name : null;

    // Sinalizar "precisa humano" derruba a confiança exibida ao agente, para o
    // card não passar segurança que o próprio modelo disse não ter.
    const confianca = s.precisa_humano ? Math.min(s.confianca, 0.4) : s.confianca;

    // Envio automático. A liberação é OPT-IN do modelo: `posso_enviar` precisa
    // vir true explicitamente. Json quebrado, campo ausente ou resposta
    // inesperada caem no rascunho — a falha nunca resulta em e-mail enviado.
    const podeAutoEnviar =
      settings.autoSendEnabled &&
      s.posso_enviar &&
      !s.precisa_humano &&
      s.resposta.trim().length > 0;

    let actionTaken = "sugerido";
    let autoSendError: string | null = null;

    if (podeAutoEnviar) {
      try {
        const [mb] = await db
          .select({ signature: mailboxes.signature })
          .from(mailboxes)
          .where(eq(mailboxes.id, msg.mailboxId))
          .limit(1);
        const assinatura = mb?.signature?.trim();

        await sendReply({
          threadId: msg.threadId,
          bodyText: assinatura ? `${s.resposta}\n\n${assinatura}` : s.resposta,
          sentByUserId: null, // null = IA/sistema, não um agente
        });
        actionTaken = "auto_enviado";
      } catch (err) {
        // Falha de SMTP não derruba a análise: o rascunho continua salvo e o
        // agente envia na mão.
        autoSendError = err instanceof Error ? err.message : String(err);
      }
    }

    await db
      .insert(aiActions)
      .values({
        messageId: msg.id,
        threadId: msg.threadId,
        categorySuggested: categoria,
        confidence: confianca,
        actionTaken,
        responseSent: s.resposta,
        summary: s.resumo,
        sourceArticleIds: s.artigos_usados.join(","),
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        errorMessage: autoSendError?.slice(0, 1000) ?? null,
        status: actionTaken === "auto_enviado" ? "usada" : "pendente",
      })
      .onConflictDoNothing();

    // A categoria da thread é do AGENTE, não da IA: fica vazia até alguém
    // escolher na tela do chamado. O palpite do modelo continua registrado em
    // ai_actions.category_suggested, como trilha de auditoria, sem vazar para
    // a fila.

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

/**
 * Rascunho pendente mais recente de uma thread, para exibir no chamado.
 * Devolve null (em vez de lançar) se as tabelas da IA não existirem.
 */
export async function getLatestSuggestion(threadId: number) {
  try {
    const [row] = await db
      .select()
      .from(aiActions)
      .where(and(eq(aiActions.threadId, threadId), eq(aiActions.status, "pendente")))
      .orderBy(desc(aiActions.createdAt))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}

/** Artigos citados por uma sugestão, para mostrar as fontes no card. */
export async function getSuggestionSources(sourceArticleIds: string | null) {
  const ids = (sourceArticleIds ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isInteger);
  if (ids.length === 0) return [];

  try {
    return await db
      .select({ id: knowledgeBase.id, title: knowledgeBase.title })
      .from(knowledgeBase)
      .where(inArray(knowledgeBase.id, ids));
  } catch (err) {
    if (isMissingRelation(err)) return [];
    throw err;
  }
}
