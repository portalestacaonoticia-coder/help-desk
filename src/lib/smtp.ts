import nodemailer from "nodemailer";
import { and, eq, desc, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { mailboxes, threads, messages, type Mailbox } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";

export type SendReplyInput = {
  threadId: number;
  bodyText: string;
  bodyHtml?: string;
  sentByUserId?: number | null;
};

/**
 * Envia uma resposta na thread, via SMTP da MESMA caixa que recebeu o e-mail.
 * Mantém o encadeamento (In-Reply-To / References) para o cliente ver como
 * continuação da conversa, e grava a mensagem outbound no banco.
 */
export async function sendReply(input: SendReplyInput) {
  const { threadId, bodyText, bodyHtml, sentByUserId } = input;

  const [thread] = await db
    .select()
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!thread) throw new Error(`Thread ${threadId} não encontrada`);

  const [mb] = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.id, thread.mailboxId))
    .limit(1);
  if (!mb) throw new Error(`Caixa ${thread.mailboxId} não encontrada`);

  // Última mensagem inbound: destinatário da resposta e alvo do In-Reply-To.
  const [lastInbound] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.threadId, threadId),
        eq(messages.direction, "inbound"),
        isNotNull(messages.messageIdHeader),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);

  const to = thread.customerAddr ?? lastInbound?.fromAddr ?? null;
  if (!to) {
    throw new Error("Não há destinatário conhecido para responder nesta thread");
  }

  const fromAddress = mb.fromAddress ?? mb.imapUser;
  const subject = replySubject(thread.subject);

  // Encadeamento: referencia a última mensagem do cliente.
  const inReplyTo = lastInbound?.messageIdHeader ?? undefined;
  const references = buildReferences(lastInbound);

  const transporter = buildTransport(mb);

  const info = await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    text: bodyText,
    html: bodyHtml,
    inReplyTo,
    references,
  });

  // Grava a mensagem enviada como outbound na thread.
  await db.insert(messages).values({
    threadId,
    mailboxId: mb.id,
    direction: "outbound",
    messageIdHeader: info.messageId ?? null,
    inReplyTo: inReplyTo ?? null,
    referencesHeader: references ?? null,
    fromAddr: fromAddress,
    toAddr: to,
    subject,
    bodyText,
    bodyHtml: bodyHtml ?? null,
    sentByUserId: sentByUserId ?? null,
    sentAt: new Date(),
  });

  // Responder não fecha o chamado: com apenas aberto/fechado, quem decide que
  // o caso acabou é o agente, pelo seletor de status.
  await db
    .update(threads)
    .set({ lastMessageAt: new Date() })
    .where(eq(threads.id, threadId));

  return { messageId: info.messageId, to };
}

/** Testa as credenciais SMTP de uma caixa sem enviar e-mail. */
export async function verifySmtp(mb: Mailbox): Promise<void> {
  const transporter = buildTransport(mb);
  await transporter.verify();
}

function buildTransport(mb: Mailbox) {
  return nodemailer.createTransport({
    host: mb.smtpHost,
    port: mb.smtpPort,
    secure: mb.smtpTls && mb.smtpPort === 465, // 465 = TLS implícito; 587 = STARTTLS
    requireTLS: mb.smtpTls && mb.smtpPort !== 465,
    auth: { user: mb.smtpUser, pass: decryptSecret(mb.smtpPassEnc) },
  });
}

function replySubject(subject: string | null): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re: (sem assunto)";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** Constrói o header References acumulando a cadeia anterior. */
function buildReferences(
  lastInbound: typeof messages.$inferSelect | undefined,
): string | undefined {
  if (!lastInbound) return undefined;
  const parts: string[] = [];
  if (lastInbound.referencesHeader) parts.push(lastInbound.referencesHeader);
  if (lastInbound.messageIdHeader) parts.push(lastInbound.messageIdHeader);
  return parts.length > 0 ? parts.join(" ") : undefined;
}
