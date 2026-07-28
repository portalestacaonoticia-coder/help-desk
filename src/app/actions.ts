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
import { verifyImap } from "@/lib/imap";

const VALID_STATUS = ["aberto", "fechado"] as const;

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
  revalidatePath("/tickets");
}

/** Muda o status da thread. */
export async function setStatusAction(formData: FormData) {
  await requireUser();
  const threadId = Number(formData.get("threadId"));
  const status = String(formData.get("status") ?? "");

  if (!VALID_STATUS.includes(status as (typeof VALID_STATUS)[number])) {
    throw new Error("Status inválido");
  }

  await db.update(threads).set({ status }).where(eq(threads.id, threadId));

  revalidatePath(`/tickets/${threadId}`);
  revalidatePath("/tickets");
}

/**
 * Define a categoria do chamado. Aceita vazio para "sem categoria" e só grava
 * nomes que existem em `categories` e estão ativos — o valor vem de um select,
 * mas a validação não pode confiar no cliente.
 */
export async function setCategoryAction(formData: FormData) {
  await requireUser();
  const threadId = Number(formData.get("threadId"));
  const category = String(formData.get("category") ?? "").trim();

  if (category) {
    const [known] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, category), eq(categories.active, true)))
      .limit(1);
    if (!known) throw new Error("Categoria inválida");
  }

  await db
    .update(threads)
    .set({ category: category || null })
    .where(eq(threads.id, threadId));

  revalidatePath(`/tickets/${threadId}`);
  revalidatePath("/tickets");
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

  revalidatePath("/tickets");
}

/** Cria uma nova macro. */
export async function createMacroAction(formData: FormData) {
  await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const shortcut = String(formData.get("shortcut") ?? "").trim() || null;

  if (!title || !body) throw new Error("Título e corpo são obrigatórios");

  await db.insert(macros).values({ title, body, shortcut });
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

export async function createCategoryAction(formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const autoRespondivel = formData.get("autoRespondivel") === "on";

  if (!name) throw new Error("Nome da categoria é obrigatório");

  await db
    .insert(categories)
    .values({ name, description, autoRespondivel })
    .onConflictDoNothing();
  revalidatePath("/base");
}

export async function toggleCategoryAction(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("id"));
  const field = String(formData.get("field") ?? "");
  const value = String(formData.get("value") ?? "") === "true";

  if (field === "active") {
    await db.update(categories).set({ active: value }).where(eq(categories.id, id));
  } else if (field === "autoRespondivel") {
    await db
      .update(categories)
      .set({ autoRespondivel: value })
      .where(eq(categories.id, id));
  } else {
    throw new Error("Campo inválido");
  }
  revalidatePath("/base");
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

  await db
    .update(aiSettings)
    .set({
      basePrompt,
      model,
      enabled,
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
    await db.insert(mailboxes).values({
      ...common,
      imapPassEnc: encryptSecret(imapPass),
      smtpPassEnc: encryptSecret(smtpPass || imapPass),
    });
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
