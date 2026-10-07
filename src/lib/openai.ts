/**
 * Cliente mínimo da API da OpenAI (Chat Completions).
 *
 * Usa fetch direto em vez de SDK: a única chamada de que precisamos é
 * /chat/completions, e assim não entra mais dependência no bundle do servidor.
 *
 * Modelos: gpt-6-luna (padrão — o mais barato da linha, US$ 0,10 / 0,50 por 1M
 * tokens) e gpt-6.1-sol (mais capaz, ~20x o preço). Ambos são modelos de
 * raciocínio: por isso o cliente controla `reasoning_effort` e NÃO envia
 * `temperature` nem `max_tokens`, que a API rejeita nessa família.
 */

const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

export const DEFAULT_MODEL = "gpt-6-luna";

/** Modelos oferecidos na tela da base. Fora daqui, cai no padrão. */
export const KNOWN_MODELS = ["gpt-6-luna", "gpt-6.1-sol"] as const;

/**
 * Normaliza o modelo salvo em ai_settings. A troca de provedor deixou valores
 * deepseek-* no banco até a migration 0012 rodar — mandar isso para a OpenAI
 * seria 400 em toda chamada do cron. Nome desconhecido vira o padrão.
 */
export function resolveModel(model: string | null | undefined): string {
  return (KNOWN_MODELS as readonly string[]).includes(model ?? "")
    ? (model as string)
    : DEFAULT_MODEL;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type ChatOptions = {
  model?: string;
  /** Teto de tokens da resposta (inclui os de raciocínio, se houver). */
  maxTokens?: number;
  /** Força a resposta a ser um objeto JSON válido. */
  json?: boolean;
  /**
   * Esforço de raciocínio. "none" por padrão — o modelo pensa antes de
   * responder quando o esforço é maior, e isso gasta tokens de saída (os mais
   * caros) e arrisca estourar o teto antes de fechar o JSON. Para classificar
   * e-mail de suporte com a base na mão, responder direto basta.
   */
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
};

export type ChatResult = {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

export class OpenAIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpenAIError";
  }
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new OpenAIError(
      "OPENAI_API_KEY não definida — configure a chave para habilitar a IA.",
    );
  }
  return key;
}

/** Uma chamada de chat completion. Lança OpenAIError em falha. */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const {
    model = DEFAULT_MODEL,
    maxTokens = 2000,
    json = false,
    reasoningEffort = "none",
    signal,
  } = options;

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: maxTokens,
      reasoning_effort: reasoningEffort,
      stream: false,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OpenAIError(
      `OpenAI respondeu ${response.status}: ${detail.slice(0, 500)}`,
      response.status,
    );
  }

  const data = (await response.json()) as {
    model?: string;
    choices?: Array<{
      message?: { content?: string | null; refusal?: string | null };
      finish_reason?: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };

  const choice = data.choices?.[0];
  const content = choice?.message?.content;

  // Estourar o teto corta o JSON no meio — melhor falhar com uma mensagem
  // que diz o que aconteceu do que deixar o JSON.parse quebrar depois.
  if (choice?.finish_reason === "length") {
    const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    throw new OpenAIError(
      reasoning > 0
        ? `Resposta truncada em ${maxTokens} tokens (${reasoning} gastos em raciocínio). Reduza o esforço de raciocínio ou aumente max_tokens.`
        : `Resposta truncada em ${maxTokens} tokens. Aumente max_tokens ou encurte os artigos da base.`,
    );
  }

  if (!content) {
    const refusal = choice?.message?.refusal;
    throw new OpenAIError(
      refusal
        ? `OpenAI recusou responder: ${refusal.slice(0, 300)}`
        : "OpenAI devolveu resposta vazia.",
    );
  }

  return {
    content,
    model: data.model ?? model,
    promptTokens: data.usage?.prompt_tokens ?? null,
    completionTokens: data.usage?.completion_tokens ?? null,
  };
}

/**
 * Chat em modo JSON, já desserializado.
 * O chamador é responsável por validar o formato do objeto.
 */
export async function chatJson<T>(
  messages: ChatMessage[],
  options: Omit<ChatOptions, "json"> = {},
): Promise<{ data: T } & Omit<ChatResult, "content">> {
  const result = await chat(messages, { ...options, json: true });

  let parsed: T;
  try {
    parsed = JSON.parse(result.content) as T;
  } catch {
    throw new OpenAIError(
      `Resposta da OpenAI não era JSON válido: ${result.content.slice(0, 300)}`,
    );
  }

  return {
    data: parsed,
    model: result.model,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
  };
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
