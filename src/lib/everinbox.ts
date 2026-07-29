/**
 * Cliente da API externa da Everinbox.
 *
 * Só o que o Help Desk precisa: remover um lead do projeto quando o contato
 * pede descadastramento. A chave vem de EVERINBOX_API_KEY e nunca aparece na
 * tela — a remoção passa sempre por server action.
 */

const BASE_URL = "https://external.everinbox.com.br";

// Timeout curto: o botão é síncrono para o agente, não pode pendurar a tela.
const TIMEOUT_MS = 15_000;

export class EverinboxError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EverinboxError";
  }
}

export function isEverinboxConfigured(): boolean {
  return Boolean(process.env.EVERINBOX_API_KEY);
}

export type EverinboxProject = { id: string; name: string };

/**
 * Lista os projetos acessíveis pela chave.
 *
 * Só funciona com chave de usuário (`uk_`); com chave de projeto (`pk_`) a API
 * não lista nada. Devolve lista vazia em qualquer falha — o seletor cai para
 * campo de texto livre em vez de travar a tela de caixas.
 */
export async function listProjects(): Promise<EverinboxProject[]> {
  const apiKey = process.env.EVERINBOX_API_KEY;
  if (!apiKey) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(new URL("/v2/projects", BASE_URL), {
      headers: { Authorization: apiKey, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return [];

    // A doc não fixa o envelope; aceitamos array puro ou { data: [...] }.
    const body: unknown = await res.json();
    const raw = Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown })?.data)
        ? (body as { data: unknown[] }).data
        : [];

    return raw
      .map((p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        const id = o.id ?? o.uuid ?? o.project_id;
        const name = o.name ?? o.title ?? id;
        return id ? { id: String(id), name: String(name) } : null;
      })
      .filter((p): p is EverinboxProject => p !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Remove um lead do projeto. `idOrEmail` aceita o id numérico ou o e-mail —
 * a API resolve os dois, então não é preciso buscar o lead antes.
 *
 * `projectId` só é exigido pela API quando a chave é de usuário (uk_); com
 * chave de projeto (pk_) ele é ignorado. Mandamos sempre que estiver
 * configurado, para funcionar nos dois casos.
 */
export async function deleteLead(params: {
  idOrEmail: string;
  projectId?: string | null;
}): Promise<void> {
  const apiKey = process.env.EVERINBOX_API_KEY;
  if (!apiKey) throw new EverinboxError("EVERINBOX_API_KEY não configurada");

  const { idOrEmail, projectId } = params;
  if (!idOrEmail.trim()) throw new EverinboxError("Contato sem e-mail");

  const url = new URL(`/v2/leads/${encodeURIComponent(idOrEmail.trim())}`, BASE_URL);
  if (projectId) url.searchParams.set("project_id", projectId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      // A chave vai crua no Authorization, sem "Bearer".
      headers: { Authorization: apiKey, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new EverinboxError("A Everinbox não respondeu a tempo");
    }
    throw new EverinboxError(
      err instanceof Error ? err.message : "Falha de rede ao chamar a Everinbox",
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.ok) return;

  // 404 = lead não existe no projeto. Para o agente o efeito é o mesmo do
  // sucesso (o contato não está mais na lista), mas vale dizer o que houve.
  const body = await res.text().catch(() => "");
  const apiMessage = extractMessage(body);

  if (res.status === 404) {
    throw new EverinboxError(
      apiMessage || "Contato não encontrado nesse projeto",
      404,
    );
  }
  throw new EverinboxError(
    apiMessage || `Everinbox respondeu ${res.status}`,
    res.status,
  );
}

/** A API devolve `{ "message": "..." }` nos erros; texto puro no pior caso. */
function extractMessage(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : "";
  } catch {
    return body.slice(0, 200);
  }
}
