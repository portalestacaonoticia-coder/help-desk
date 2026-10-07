"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
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
  autoReplies,
  mailboxes,
  contactReviews,
} from "@/db/schema";
import { sendReply, verifySmtp } from "@/lib/smtp";
import { encryptSecret } from "@/lib/crypto";
import { suggestReplyForMessage, getAiSettings } from "@/lib/ai";
import { isAiConfigured, resolveModel } from "@/lib/openai";
import { verifyImap, skipToLatest } from "@/lib/imap";
import { runCleanup } from "@/lib/retention";
import { deleteLead, EverinboxError } from "@/lib/everinbox";
import { isCategory, isLanguage, languageLabel, STATUS_LABELS } from "@/lib/ui";

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
/**
 * Resultado do descadastramento de um contato. `ok` é false só em falha
 * real: timeout da Everinbox devolve ok com aviso, porque a remoção quase
 * certamente aconteceu.
 */
export type UnsubscribeResult = { ok: boolean; message: string };

/**
 * Remove um e-mail de todos os projetos da Everinbox ligados à caixa.
 * Núcleo compartilhado pelo botão do chamado e pela triagem de cancelamentos.
 */
async function unsubscribeFromMailboxProjects(
  email: string,
  mailboxId: number,
): Promise<UnsubscribeResult> {
  const [mb] = await db
    .select({ everinboxProjectIds: mailboxes.everinboxProjectIds })
    .from(mailboxes)
    .where(eq(mailboxes.id, mailboxId))
    .limit(1);

  const projetos = (mb?.everinboxProjectIds ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (projetos.length === 0) {
    return {
      ok: false,
      message: "A operação desta caixa não está ligada a nenhum projeto na Everinbox.",
    };
  }

  /**
   * Um projeto. Em caso de timeout tenta de novo: o DELETE é idempotente, e
   * se a primeira chamada tiver funcionado a segunda devolve 404 — que aqui
   * significa "já saiu", ou seja, o resultado que queríamos.
   */
  async function removerDe(projectId: string) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        await deleteLead({ idOrEmail: email, projectId });
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

  const conta = (v: string) =>
    resultados.filter((r) => r.status === "fulfilled" && r.value === v).length;

  const removidos = conta("removido");
  const ausentes = conta("ausente");
  const incertos = conta("incerto");
  const erros = resultados.filter((r) => r.status === "rejected");

  if (erros.length > 0) {
    const motivo = (erros[0] as PromiseRejectedResult).reason;
    return {
      ok: false,
      message: `Falhou em ${erros.length} de ${projetos.length} projeto(s): ${
        motivo instanceof Error ? motivo.message : String(motivo)
      }`,
    };
  }

  // Timeout não é falha: a remoção provavelmente aconteceu, só não confirmou.
  if (incertos > 0) {
    return {
      ok: true,
      message: `${email} removido de ${removidos + ausentes} projeto(s). Em ${incertos} a Everinbox não confirmou a tempo — provavelmente saiu também, confira no painel dela.`,
    };
  }
  if (removidos === 0) {
    return {
      ok: true,
      message: `${email} já não estava em nenhum dos ${projetos.length} projeto(s).`,
    };
  }
  return {
    ok: true,
    message: `${email} removido de ${removidos} projeto(s)${ausentes > 0 ? ` (não estava em ${ausentes})` : ""}.`,
  };
}

export async function unsubscribeContactAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const user = await requireUser();
  const threadId = Number(formData.get("threadId"));

  const [thread] = await db
    .select({ customerAddr: threads.customerAddr, mailboxId: threads.mailboxId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!thread) return "Chamado não encontrado.";
  if (!thread.customerAddr) return "Este chamado não tem e-mail de contato.";

  const result = await unsubscribeFromMailboxProjects(
    thread.customerAddr,
    thread.mailboxId,
  );

  // Registra igual à triagem: é daqui que a dashboard conta os cancelamentos,
  // e assim o contato também não reaparece na tela de Cancelamentos.
  if (result.ok) {
    const [ultima] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.threadId, threadId))
      .orderBy(desc(messages.id))
      .limit(1);
    if (ultima) {
      await saveContactReview(
        {
          mailboxId: thread.mailboxId,
          email: thread.customerAddr.trim().toLowerCase(),
          lastMessageId: ultima.id,
        },
        "descadastrado",
        result.message,
        Number(user.id) || null,
      );
    }
  }

  revalidatePath(`/tickets/${threadId}`);
  return result.message;
}

/* ------------------------------------------------------------------ */
/* Triagem de cancelamentos (/cancelamentos)                           */
/* ------------------------------------------------------------------ */

/** Um contato da tela de cancelamentos, como o cliente o identifica. */
export type FlaggedContactRef = {
  mailboxId: number;
  email: string;
  /** Mensagem mais recente na lista — é até onde a decisão vale. */
  lastMessageId: number;
};

function parseFlaggedRef(ref: FlaggedContactRef): FlaggedContactRef | null {
  const mailboxId = Number(ref?.mailboxId);
  const lastMessageId = Number(ref?.lastMessageId);
  const email = String(ref?.email ?? "").trim().toLowerCase();
  if (!Number.isInteger(mailboxId) || mailboxId <= 0) return null;
  if (!Number.isInteger(lastMessageId) || lastMessageId <= 0) return null;
  if (!email.includes("@")) return null;
  return { mailboxId, email, lastMessageId };
}

async function saveContactReview(
  ref: FlaggedContactRef,
  status: "descadastrado" | "ignorado",
  note: string | null,
  userId: number | null,
) {
  await db
    .insert(contactReviews)
    .values({
      mailboxId: ref.mailboxId,
      email: ref.email,
      status,
      lastMessageId: ref.lastMessageId,
      note,
      reviewedByUserId: userId,
      reviewedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [contactReviews.mailboxId, contactReviews.email],
      // Ignorar um contato que JÁ foi descadastrado (ele escreveu de novo) só
      // avança a mensagem coberta. Status, nota, autor e data do descadastro
      // ficam — senão o cancelamento sumiria da dashboard no dia em que
      // aconteceu.
      set:
        status === "ignorado"
          ? {
              lastMessageId: ref.lastMessageId,
              status: sql`case when ${contactReviews.status} = 'descadastrado' then 'descadastrado' else 'ignorado' end`,
              note: sql`case when ${contactReviews.status} = 'descadastrado' then ${contactReviews.note} else null end`,
              reviewedByUserId: sql`case when ${contactReviews.status} = 'descadastrado' then ${contactReviews.reviewedByUserId} else ${userId} end`,
              reviewedAt: sql`case when ${contactReviews.status} = 'descadastrado' then ${contactReviews.reviewedAt} else now() end`,
            }
          : {
              status,
              lastMessageId: ref.lastMessageId,
              note,
              reviewedByUserId: userId,
              reviewedAt: new Date(),
            },
    });
}

/**
 * Descadastra UM contato da triagem na Everinbox e registra a decisão.
 *
 * Um por chamada, de propósito: a tela percorre a seleção e mostra o
 * resultado de cada linha. Em lote numa action só, 20 contatos × 25s de
 * timeout estourariam o tempo da função e ninguém saberia quem saiu.
 *
 * Falha real NÃO grava decisão — o contato continua na lista para tentar
 * de novo. Timeout grava como descadastrado com a ressalva na nota.
 *
 * Não revalida a rota: quem chama em lote atualiza a lista uma vez no fim.
 */
export async function unsubscribeFlaggedContactAction(
  input: FlaggedContactRef,
): Promise<UnsubscribeResult> {
  const user = await requireUser();
  const ref = parseFlaggedRef(input);
  if (!ref) return { ok: false, message: "Contato inválido." };

  const result = await unsubscribeFromMailboxProjects(ref.email, ref.mailboxId);
  if (result.ok) {
    await saveContactReview(ref, "descadastrado", result.message, Number(user.id) || null);
  }
  // Sem revalidatePath aqui: a tela chama vários destes em sequência e
  // atualiza a lista uma vez só, no fim do lote.
  return result;
}

/**
 * Marca contatos da triagem como ignorados (falso positivo, ou cliente que
 * já foi atendido de outra forma). Nada sai do Help Desk: é só registro.
 */
export async function ignoreFlaggedContactsAction(
  input: FlaggedContactRef[],
): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const refs = (Array.isArray(input) ? input : [])
    .map(parseFlaggedRef)
    .filter((r): r is FlaggedContactRef => r !== null);
  if (refs.length === 0) return { ok: false, message: "Nenhum contato válido." };

  for (const ref of refs) {
    await saveContactReview(ref, "ignorado", null, Number(user.id) || null);
  }
  const n = refs.length;
  return {
    ok: true,
    message: `${n} contato${n === 1 ? "" : "s"} ignorado${n === 1 ? "" : "s"}.`,
  };
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

/** Remove uma resposta pronta. Sem desfazer. */
export async function deleteMacroAction(formData: FormData) {
  await requireUser();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;

  await db.delete(macros).where(eq(macros.id, id));
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

  // Os campos desta tela ficam FORA do <form> e se ligam a ele pelo atributo
  // `form` (ver src/app/base/page.tsx). Se essa associação falhar, o submit
  // chega vazio — e "vazio" aqui significaria apagar os dois prompts. Um
  // textarea existente pode estar em branco, mas ausente ele nunca está.
  if (!formData.has("basePrompt") || !formData.has("autoSendPrompt")) {
    throw new Error(
      "Formulário incompleto — recarregue a página e salve de novo.",
    );
  }

  const basePrompt = String(formData.get("basePrompt") ?? "").trim();
  const model = resolveModel(String(formData.get("model") ?? "").trim());
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

/* ------------------------------------------------------------------ */
/* Respostas automáticas (texto padrão por caixa e idioma)             */
/* ------------------------------------------------------------------ */

/**
 * Cria ou edita o texto padrão de uma caixa num idioma. Com `id` no form,
 * edita.
 *
 * Devolve mensagem em vez de lançar: o erro mais provável aqui é tentar um
 * segundo texto no mesmo idioma da mesma caixa, e isso é uma correção de
 * formulário — não merece tela de erro.
 */
export async function saveAutoReplyAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();

  const rawId = String(formData.get("id") ?? "").trim();
  const id = rawId ? Number(rawId) : null;
  const mailboxId = Number(String(formData.get("mailboxId") ?? "").trim());
  const language = String(formData.get("language") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const active = formData.get("active") === "on";

  if (!Number.isInteger(mailboxId) || mailboxId <= 0) {
    return "Selecione a caixa que vai usar esta resposta.";
  }
  if (!isLanguage(language)) return "Selecione o idioma da resposta.";
  if (!body) return "Cole o texto da resposta.";

  // Um texto por caixa e idioma — o mesmo que o índice único garante no banco.
  // Checado antes para devolver frase legível em vez do erro cru do Postgres.
  const [conflito] = await db
    .select({ id: autoReplies.id })
    .from(autoReplies)
    .where(
      and(
        eq(autoReplies.mailboxId, mailboxId),
        eq(autoReplies.language, language),
        id ? ne(autoReplies.id, id) : undefined,
      ),
    )
    .limit(1);

  if (conflito) {
    return `Essa caixa já tem uma resposta em ${languageLabel(language)}. Edite a existente.`;
  }

  try {
    if (id) {
      await db
        .update(autoReplies)
        .set({ mailboxId, language, body, active, updatedAt: new Date() })
        .where(eq(autoReplies.id, id));
    } else {
      await db.insert(autoReplies).values({ mailboxId, language, body, active });
    }
  } catch (err) {
    return `Falhou: ${err instanceof Error ? err.message : String(err)}`;
  }

  revalidatePath("/base");
  return `Resposta em ${languageLabel(language)} salva.`;
}

/** Remove o texto padrão de um idioma. Sem desfazer. */
export async function deleteAutoReplyAction(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;

  await db.delete(autoReplies).where(eq(autoReplies.id, id));
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
  if (!isAiConfigured()) return "OPENAI_API_KEY não está configurada.";

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
