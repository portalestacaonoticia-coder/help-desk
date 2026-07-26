/**
 * Cliente mínimo da API do DeepSeek (formato compatível com OpenAI).
 *
 * Usa fetch direto em vez de SDK: a única chamada de que precisamos é
 * /chat/completions, e assim não entra mais dependência no bundle do servidor.
 *
 * Modelos atuais: deepseek-v4-flash (padrão) e deepseek-v4-pro.
 * Os antigos deepseek-chat / deepseek-reasoner foram depreciados em 24/07/2026.
 */

const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

export const DEFAULT_MODEL = "deepseek-v4-flash";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Força a resposta a ser um objeto JSON válido. */
  json?: boolean;
  signal?: AbortSignal;
};

export type ChatResult = {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
};

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

function getApiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new DeepSeekError(
      "DEEPSEEK_API_KEY não definida — configure a chave para habilitar a IA.",
    );
  }
  return key;
}

/** Uma chamada de chat completion. Lança DeepSeekError em falha. */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const {
    model = DEFAULT_MODEL,
    temperature = 0.3,
    maxTokens = 1500,
    json = false,
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
      temperature,
      max_tokens: maxTokens,
      stream: false,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DeepSeekError(
      `DeepSeek respondeu ${response.status}: ${detail.slice(0, 500)}`,
      response.status,
    );
  }

  const data = (await response.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content;
  // O JSON mode do DeepSeek ocasionalmente devolve conteúdo vazio.
  if (!content) {
    throw new DeepSeekError("DeepSeek devolveu resposta vazia.");
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
    throw new DeepSeekError(
      `Resposta do DeepSeek não era JSON válido: ${result.content.slice(0, 300)}`,
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
  return Boolean(process.env.DEEPSEEK_API_KEY);
}
