"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { AuthError } from "next-auth";
import { auth, signIn, signOut } from "@/lib/auth";
import { db } from "@/db";
import {
  threads,
  messages,
  macros,
  categories,
  knowledgeBase,
  aiSettings,
  aiActions,
  mailboxes,
} from "@/db/schema";
import { sendReply, verifySmtp } from "@/lib/smtp";
import { encryptSecret } from "@/lib/crypto";
import { suggestReplyForMessage, getAiSettings } from "@/lib/ai";
import { isAiConfigured } from "@/lib/deepseek";
import { verifyImap, skipToLatest } from "@/lib/imap";
import { runCleanup } from "@/lib/retention";
import { deleteLead, EverinboxError } from "@/lib/everinbox";
import { isCategory, STATUS_LABELS } from "@/lib/ui";

const VALID_STATUS = ["aberto", "fechado"] as const;

/**
 * Revalida o layout inteiro, não só a rota atual.
 *
 * Os contadores da sidebar (fila por operação, recebidas hoje) são calculados
 * no AppShell, que roda em TODAS as telas. Revalidar só `/tickets` deixava o
 * número velho ao fechar um chamado a partir da tela dele ou de outra página.
 */
function revalidateShell() {
  revalidatePath("/", "layout");
}

/** Login com credenciais. Retorna mensagem de erro ou redireciona. */
export async function loginAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/tickets",
    });
  } catch (err) {
    // signIn com redirectTo lança NEXT_REDIRECT em caso de sucesso — repropaga.
    if (err instanceof AuthError) {
      return "E-mail ou senha inválidos.";
    }
    throw err;
  }
  return undefined;
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Não autenticado");
  return session.user as { id: string; role: string; name?: string | null };
}

/** Envia resposta ao cliente via SMTP da caixa de origem. */
export async function replyAction(formData: FormData) {
  const user = await requireUser();
  const threadId = Number(formData.get("threadId"));
  const body = String(formData.get("body") ?? "").trim();

  if (!threadId || !body) {
    throw new Error("Thread e corpo da resposta são obrigatórios");
  }

  await sendReply({
    threadId,
    bodyText: body,
    sentByUserId: Number(user.id),
  });

  // Responder encerra o rascunho pendente: "usada" quando o agente partiu dele,
  // "descartada" quando escreveu do zero. Sem isso o card ficaria na tela para
  // sempre, mesmo com a conversa já respondida.
  const suggestionId = Number(formData.get("suggestionId"));
  const used = Number.isInteger(suggestionId) && suggestionId > 0;

  await db
    .update(aiActions)
    .set(
      used
        ? { status: "usada", reviewed: true, reviewResult: "correta" }
        : { status: "descartada", reviewed: true },
    )
    .where(
      and(
        eq(aiActions.threadId, threadId),
        eq(aiActions.status, "pendente"),
        used ? eq(aiActions.id, suggestionId) : undefined,
      ),
    );

  // Quando o agente aproveitou uma sugestão, as demais pendentes da thread
  // (rascunhos antigos) também saem da tela.
  if (used) {
    await db
      .update(aiActions)
      .set({ status: "descartada", reviewed: true })
      .where(and(eq(aiActions.threadId, threadId), eq(aiActions.status, "pendente")));
  }

  revalidatePath(`/tickets/${threadId}`);
  revalidateShell();
}

/**
 * Muda o status da thread.
 *
 * Devolve mensagem em vez de lançar: sem retorno, uma falha no banco não
 * aparecia na tela — o clique simplesmente não fazia nada.
 */
export async function setStatusAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireUser();
  const threadId = Number(formData.get("threadId"));
  const status = String(formData.get("status") ?? "");

  if (!VALID_STATUS.includes(status as (typeof VALID_STATUS)[number])) {
    return "Status inválido.";
  }

  try {
    await db.update(threads).set({ status }).where(eq(threads.id, threadId));
  } catch (err) {
    return `Falhou: ${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath(`/tickets/${threadId}`);
  revalidateShell();
  return `Status alterado para ${STATUS_LABELS[status] ?? status}.`;
}

/**
 * Define a categoria do chamado. Vazio limpa a categoria. A lista é fixa em
 * lib/ui — o valor vem de um select, mas a validação não confia no cliente.
 */
export async function setCategoryAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireUser();
  const threadId = Number(formData.get("threadId"));
  const category = String(formData.get("category") ?? "").trim();

  if (category && !isCategory(category)) return "Categoria inválida.";

  try {
    await db
      .update(threads)
      .set({ category: category || null })
      .where(eq(threads.id, threadId));
  } catch (err) {
    return `Falhou: ${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath(`/tickets/${threadId}`);
  revalidateShell();
  return category ? `Categoria: ${category}.` : "Categoria removida.";
}

/**
 * Muda o status de vários chamados de uma vez.
 *
 * Não exige admin, ao contrário da remoção: mudar status é reversível em um
 * clique, apagar não.
 */
export async function bulkSetStatusAction(formData: FormData) {
  await requireUser();

  const status = String(formData.get("status") ?? "");
  if (!VALID_STATUS.includes(status as (typeof VALID_STATUS)[number])) {
    throw new Error("Status inválido");
  }

  const ids = formData
    .getAll("ids")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return;

  await db.update(threads).set({ status }).where(inArray(threads.id, ids));
  revalidateShell();
}

/**
 * Remove chamados em lote. DESTRUTIVO e sem desfazer: apaga também as
 * mensagens e as análises da IA de cada thread.
 *
 * A ordem importa por causa das FKs: ai_actions aponta para messages e para
 * threads, e messages aponta para threads.
 */
export async function deleteThreadsAction(formData: FormData) {
  await requireAdmin();

  const ids = formData
    .getAll("ids")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return;

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

  revalidateShell();
}

/**
 * Remove o contato da thread do projeto da operação na Everinbox.
 *
 * Ação externa e irreversível pelo Help Desk: o lead sai da base de e-mail
 * marketing. Por isso devolve mensagem em vez de lançar — o agente precisa
 * ver o que aconteceu.
 */
export async function unsubscribeContactAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireUser();
  const threadId = Number(formData.get("threadId"));

  const [thread] = await db
    .select({ customerAddr: threads.customerAddr, mailboxId: threads.mailboxId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!thread) return "Chamado não encontrado.";
  if (!thread.customerAddr) return "Este chamado não tem e-mail de contato.";

  const [mb] = await db
    .select({ everinboxProjectIds: mailboxes.everinboxProjectIds })
    .from(mailboxes)
    .where(eq(mailboxes.id, thread.mailboxId))
    .limit(1);

  const projetos = (mb?.everinboxProjectIds ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (projetos.length === 0) {
    return "A operação desta caixa não está ligada a nenhum projeto na Everinbox.";
  }

  const email = thread.customerAddr;

  /**
   * Um projeto. Em caso de timeout tenta de novo: o DELETE é idempotente, e
   * se a primeira chamada tiver funcionado a segunda devolve 404 — que aqui
   * significa "já saiu", ou seja, o resultado que queríamos.
   */
  async function removerDe(projectId: string) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        await deleteLead({ idOrEmail: email!, projectId });
        return "removido" as const;
      } catch (err) {
        if (err instanceof EverinboxError && err.status === 404) {
          // 404 na PRIMEIRA tentativa: o contato realmente não estava lá.
          // 404 na SEGUNDA, depois de um timeout: quem tirou fomos nós — a
          // primeira chamada executou, só não confirmou a tempo.
          return tentativa === 1 ? ("ausente" as const) : ("removido" as const);
        }
        if (err instanceof EverinboxError && err.timedOut && tentativa === 1) {
          continue; // segunda e última tentativa
        }
        if (err instanceof EverinboxError && err.timedOut) {
          return "incerto" as const;
        }
        throw err;
      }
    }
    return "incerto" as const;
  }

  // Em paralelo: sequencial, com 3 projetos e timeout de 25s, a action inteira
  // poderia passar do limite de tempo da função.
  const resultados = await Promise.allSettled(projetos.map(removerDe));

  revalidatePath(`/tickets/${threadId}`);

  const conta = (v: string) =>
    resultados.filter((r) => r.status === "fulfilled" && r.value === v).length;

  const removidos = conta("removido");
  const ausentes = conta("ausente");
  const incertos = conta("incerto");
  const erros = resultados.filter((r) => r.status === "rejected");

  if (erros.length > 0) {
    const motivo = (erros[0] as PromiseRejectedResult).reason;
    return `Falhou em ${erros.length} de ${projetos.length} projeto(s): ${
      motivo instanceof Error ? motivo.message : String(motivo)
    }`;
  }

  // Timeout não é falha: a remoção provavelmente aconteceu, só não confirmou.
  if (incertos > 0) {
    return `${email} removido de ${removidos + ausentes} projeto(s). Em ${incertos} a Everinbox não confirmou a tempo — provavelmente saiu também, confira no painel dela.`;
  }
  if (removidos === 0) {
    return `${email} já não estava em nenhum dos ${projetos.length} projeto(s).`;
  }
  return `${email} removido de ${removidos} projeto(s)${ausentes > 0 ? ` (não estava em ${ausentes})` : ""}.`;
}

/** Cria uma nova macro. */
/**
 * Descarta o backlog da caixa: o ponteiro pula para o fim da INBOX e só
 * e-mails novos passam a ser ingeridos.
 *
 * Sem volta pela aplicação — os e-mails anteriores continuam no servidor, mas
 * o Help Desk não os lerá mais.
 */
export async function skipBacklogAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();
  const id = Number(formData.get("id"));

  const [mb] = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1);
  if (!mb) return "Caixa não encontrada.";

  try {
    const novoUid = await skipToLatest(mb);
    revalidatePath("/caixas");
    return `Ponteiro movido para o UID ${novoUid}. Só e-mails novos daqui em diante.`;
  } catch (err) {
    return `Falhou: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Limpeza sob demanda do banco. DESTRUTIVO: apaga respostas, mensagens e
 * análises da IA que casem com o filtro.
 *
 * A idade mínima é obrigatória e nunca menor que 1 dia — sem isso um clique
 * distraído apagaria o movimento do dia.
 */
export async function cleanupThreadsAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();

  const diasRaw = Number(formData.get("dias"));
  const dias = Number.isFinite(diasRaw) && diasRaw >= 1 ? Math.floor(diasRaw) : 7;
  const filtro = {
    dias,
    somenteFechadas: formData.get("somenteFechadas") === "on",
    semResposta: formData.get("semResposta") === "on",
  };

  try {
    const { removidas, concluido } = await runCleanup(filtro);
    revalidateShell();
    if (removidas === 0) return "Nada a remover com esse filtro.";
    return concluido
      ? `${removidas} resposta${removidas === 1 ? "" : "s"} removida${removidas === 1 ? "" : "s"}.`
      : `${removidas} removidas — ainda há mais, clique de novo para continuar.`;
  } catch (err) {
    return `Falhou: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Cria ou edita uma resposta pronta. Com `id` no form, edita. */
export async function saveMacroAction(formData: FormData) {
  await requireUser();
  const rawId = String(formData.get("id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const shortcut = String(formData.get("shortcut") ?? "").trim() || null;
  const mailboxId = Number(String(formData.get("mailboxId") ?? "").trim());

  if (!title || !body) throw new Error("Título e corpo são obrigatórios");
  // Caixa é obrigatória: resposta sem caixa aparece em todas as operações, e
  // o texto de uma marca não serve para outra.
  if (!Number.isInteger(mailboxId) || mailboxId <= 0) {
    throw new Error("Selecione a caixa de entrada da resposta");
  }

  if (rawId) {
    await db
      .update(macros)
      .set({ mailboxId, title, body, shortcut })
      .where(eq(macros.id, Number(rawId)));
  } else {
    await db.insert(macros).values({ mailboxId, title, body, shortcut });
  }
  revalidatePath("/macros");
}

/* ------------------------------------------------------------------ */
/* Base de conhecimento e configuração da IA                           */
/* ------------------------------------------------------------------ */

async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Error("Apenas administradores podem alterar esta configuração");
  }
  return user;
}

export async function saveArticleAction(formData: FormData) {
  await requireUser();
  const rawId = String(formData.get("id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const keywords = String(formData.get("keywords") ?? "").trim() || null;
  const rawCategory = String(formData.get("categoryId") ?? "").trim();
  const categoryId = rawCategory ? Number(rawCategory) : null;

  if (!title || !content) throw new Error("Título e conteúdo são obrigatórios");

  if (rawId) {
    await db
      .update(knowledgeBase)
      .set({ title, content, keywords, categoryId, updatedAt: new Date() })
      .where(eq(knowledgeBase.id, Number(rawId)));
  } else {
    await db.insert(knowledgeBase).values({ title, content, keywords, categoryId });
  }
  revalidatePath("/base");
}

export async function deleteArticleAction(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("id"));
  await db.delete(knowledgeBase).where(eq(knowledgeBase.id, id));
  revalidatePath("/base");
}

/** Salva o prompt base e os demais parâmetros da IA. */
export async function saveAiSettingsAction(formData: FormData) {
  await requireAdmin();
  await getAiSettings(); // garante que a linha singleton existe

  const basePrompt = String(formData.get("basePrompt") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim() || "deepseek-v4-flash";
  const enabled = formData.get("enabled") === "on";
  const autoSendPrompt = String(formData.get("autoSendPrompt") ?? "").trim();
  const autoSendEnabled = formData.get("autoSendEnabled") === "on";

  await db
    .update(aiSettings)
    .set({
      basePrompt,
      model,
      enabled,
      autoSendPrompt,
      autoSendEnabled,
      updatedAt: new Date(),
    })
    .where(eq(aiSettings.id, 1));

  revalidatePath("/base");
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ */
/* Sugestões da IA                                                     */
/* ------------------------------------------------------------------ */

/**
 * Gera (ou regenera) o rascunho da IA para a última mensagem recebida.
 * Devolve mensagem de erro em vez de lançar — o botão usa useActionState.
 */
export async function generateSuggestionAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireUser();
  const threadId = Number(formData.get("threadId"));
  const messageId = Number(formData.get("messageId"));
  if (!messageId) return "Mensagem não informada.";

  // Checa a disponibilidade ANTES de apagar: se a IA está fora do ar, o
  // rascunho anterior é a única coisa que o agente tem em mãos.
  const settings = await getAiSettings();
  if (!settings.enabled) {
    return "A geração está desligada nas configurações da base de conhecimento.";
  }
  if (!isAiConfigured()) return "DEEPSEEK_API_KEY não está configurada.";

  // Regenerar: remove a análise anterior daquela mensagem.
  await db.delete(aiActions).where(eq(aiActions.messageId, messageId));

  const result = await suggestReplyForMessage(messageId);
  revalidatePath(`/tickets/${threadId}`);
  return result.ok ? undefined : (result.error ?? "Falha ao gerar sugestão.");
}

/** Marca um rascunho como usado ou descartado. */
export async function reviewSuggestionAction(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("id"));
  const threadId = Number(formData.get("threadId"));
  const status = String(formData.get("status") ?? "");

  if (!["usada", "descartada"].includes(status)) {
    throw new Error("Status de revisão inválido");
  }

  await db
    .update(aiActions)
    .set({
      status,
      reviewed: true,
      reviewResult: status === "usada" ? "correta" : "errada",
    })
    .where(eq(aiActions.id, id));

  revalidatePath(`/tickets/${threadId}`);
}

/* ------------------------------------------------------------------ */
/* Caixas de e-mail                                                    */
/* ------------------------------------------------------------------ */

export async function saveMailboxAction(formData: FormData) {
  await requireAdmin();

  const rawId = String(formData.get("id") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  // Sem operação informada, a navegação cai no rótulo.
  const operation = String(formData.get("operation") ?? "").trim() || label;
  const imapHost = String(formData.get("imapHost") ?? "").trim();
  const imapUser = String(formData.get("imapUser") ?? "").trim();
  const imapPass = String(formData.get("imapPass") ?? "");
  const smtpHost = String(formData.get("smtpHost") ?? "").trim();
  const smtpUser = String(formData.get("smtpUser") ?? "").trim() || imapUser;
  const smtpPass = String(formData.get("smtpPass") ?? "");
  const fromAddress = String(formData.get("fromAddress") ?? "").trim() || imapUser;
  const signature = String(formData.get("signature") ?? "").trim() || null;
  const siteUrl = String(formData.get("siteUrl") ?? "").trim() || null;
  const aiPrompt = String(formData.get("aiPrompt") ?? "").trim() || null;
  // Seleção múltipla: o form manda um `everinboxProjectIds` por projeto marcado.
  const everinboxProjectIds =
    formData
      .getAll("everinboxProjectIds")
      .map((v) => String(v).trim())
      .filter(Boolean)
      .join(",") || null;

  const imapPort = Number(formData.get("imapPort")) || 993;
  const smtpPort = Number(formData.get("smtpPort")) || 465;
  const imapTls = formData.get("imapTls") === "on";
  const smtpTls = formData.get("smtpTls") === "on";
  const active = formData.get("active") === "on";

  if (!label || !imapHost || !imapUser || !smtpHost) {
    throw new Error("Rótulo, host e usuário IMAP e host SMTP são obrigatórios");
  }

  const common = {
    label,
    operation,
    imapHost,
    imapPort,
    imapUser,
    imapTls,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpTls,
    fromAddress,
    signature,
    siteUrl,
    aiPrompt,
    everinboxProjectIds,
    active,
  };

  if (rawId) {
    // Senha em branco na edição significa "manter a que já está cifrada".
    await db
      .update(mailboxes)
      .set({
        ...common,
        ...(imapPass ? { imapPassEnc: encryptSecret(imapPass) } : {}),
        ...(smtpPass ? { smtpPassEnc: encryptSecret(smtpPass) } : {}),
      })
      .where(eq(mailboxes.id, Number(rawId)));
  } else {
    if (!imapPass) throw new Error("Senha IMAP é obrigatória para cadastrar a caixa");
    const [criada] = await db
      .insert(mailboxes)
      .values({
        ...common,
        imapPassEnc: encryptSecret(imapPass),
        smtpPassEnc: encryptSecret(smtpPass || imapPass),
      })
      .returning();

    // Caixa nova nasce com last_uid = 0, o que faria a ingestão varrer a INBOX
    // inteira desde o e-mail mais antigo. Quase nunca é o que se quer: o
    // padrão é começar do presente.
    // Checkbox desmarcado não é enviado, então o teste é por "on".
    if (formData.get("skipBacklog") === "on" && criada) {
      try {
        await skipToLatest(criada);
      } catch {
        // Best-effort: se o IMAP não responder agora, a caixa fica cadastrada
        // e o botão "Pular backlog" resolve depois.
      }
    }
  }

  revalidatePath("/caixas");
}

/**
 * Testa IMAP e SMTP de uma caixa e devolve o resultado de cada um.
 * Usada com useActionState na tela de caixas.
 */
export async function testMailboxAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();
  const id = Number(formData.get("id"));

  const [mb] = await db.select().from(mailboxes).where(eq(mailboxes.id, id)).limit(1);
  if (!mb) return "Caixa não encontrada.";

  const parts: string[] = [];
  try {
    await verifyImap(mb);
    parts.push("IMAP ok");
  } catch (err) {
    parts.push(`IMAP falhou: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    await verifySmtp(mb);
    parts.push("SMTP ok");
  } catch (err) {
    parts.push(`SMTP falhou: ${err instanceof Error ? err.message : String(err)}`);
  }

  return parts.join(" · ");
}
