"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { AuthError } from "next-auth";
import { auth, signIn, signOut } from "@/lib/auth";
import { db } from "@/db";
import { threads, macros } from "@/db/schema";
import { sendReply } from "@/lib/smtp";

const VALID_STATUS = [
  "novo",
  "em_andamento",
  "aguardando_cliente",
  "resolvido",
] as const;

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

  revalidatePath(`/tickets/${threadId}`);
  revalidatePath("/tickets");
}

/** Atribui (ou desatribui) a thread a um agente. */
export async function assignAction(formData: FormData) {
  await requireUser();
  const threadId = Number(formData.get("threadId"));
  const raw = String(formData.get("agentId") ?? "");
  const agentId = raw === "" ? null : Number(raw);

  await db
    .update(threads)
    .set({ assignedAgentId: agentId })
    .where(eq(threads.id, threadId));

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
