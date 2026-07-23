import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { and, eq, inArray, desc, gte } from "drizzle-orm";
import { db } from "@/db";
import { mailboxes, threads, messages, ingestLogs, type Mailbox } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import {
  normalizeSubject,
  extractEmail,
  parseReferencedIds,
} from "@/lib/threading";

export type IngestResult = {
  mailboxId: number;
  label: string;
  fetched: number;
  status: "ok" | "error";
  error?: string;
};

// Janela para agrupar por assunto quando não há In-Reply-To/References.
const SUBJECT_MATCH_WINDOW_DAYS = 30;

/**
 * Encontra (ou cria) a thread à qual uma mensagem recebida pertence.
 * Retorna o id da thread.
 */
async function resolveThread(params: {
  mailboxId: number;
  subject: string | null;
  customerAddr: string | null;
  referencedIds: string[];
}): Promise<number> {
  const { mailboxId, subject, customerAddr, referencedIds } = params;

  // 1) Por In-Reply-To / References: alguma mensagem conhecida com esse Message-ID?
  if (referencedIds.length > 0) {
    const parent = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(
        and(
          eq(messages.mailboxId, mailboxId),
          inArray(messages.messageIdHeader, referencedIds),
        ),
      )
      .limit(1);
    if (parent.length > 0) return parent[0].threadId;
  }

  // 2) Por assunto normalizado + mesmo cliente, na mesma caixa, recente.
  const subjectNormalized = normalizeSubject(subject);
  if (subjectNormalized && customerAddr) {
    const since = new Date(
      Date.now() - SUBJECT_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const existing = await db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.mailboxId, mailboxId),
          eq(threads.subjectNormalized, subjectNormalized),
          eq(threads.customerAddr, customerAddr),
          gte(threads.lastMessageAt, since),
        ),
      )
      .orderBy(desc(threads.lastMessageAt))
      .limit(1);
    if (existing.length > 0) return existing[0].id;
  }

  // 3) Nova thread.
  const [created] = await db
    .insert(threads)
    .values({
      mailboxId,
      subject: subject ?? null,
      subjectNormalized: subjectNormalized || null,
      customerAddr,
      status: "novo",
    })
    .returning({ id: threads.id });
  return created.id;
}

/** Converte um e-mail parseado em uma linha de `messages` (sem thread ainda). */
function toMessageRow(parsed: ParsedMail, uid: number, mailboxId: number) {
  const fromAddr = parsed.from?.text ?? null;
  const toAddr = Array.isArray(parsed.to)
    ? parsed.to.map((t) => t.text).join(", ")
    : parsed.to?.text ?? null;

  return {
    mailboxId,
    direction: "inbound" as const,
    messageIdHeader: parsed.messageId ?? null,
    inReplyTo: parsed.inReplyTo ?? null,
    referencesHeader: Array.isArray(parsed.references)
      ? parsed.references.join(" ")
      : parsed.references ?? null,
    fromAddr,
    toAddr,
    subject: parsed.subject ?? null,
    bodyText: parsed.text ?? null,
    bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
    imapUid: uid,
    sentAt: parsed.date ?? null,
  };
}

/**
 * Processa uma caixa: conecta, busca UIDs novos, grava mensagens e atualiza last_uid.
 * Idempotente: rodar duas vezes sobre o mesmo UID não duplica (índices únicos +
 * checagem de existência antes de criar thread).
 */
export async function ingestMailbox(mb: Mailbox): Promise<IngestResult> {
  const base = { mailboxId: mb.id, label: mb.label };
  const client = new ImapFlow({
    host: mb.imapHost,
    port: mb.imapPort,
    secure: mb.imapTls,
    auth: { user: mb.imapUser, pass: decryptSecret(mb.imapPassEnc) },
    logger: false,
  });

  let fetched = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailboxInfo = client.mailbox;
      const currentUidValidity =
        mailboxInfo && typeof mailboxInfo !== "boolean"
          ? String(mailboxInfo.uidValidity)
          : null;

      // Se o UIDVALIDITY mudou, os UIDs foram reciclados: reseta o ponteiro.
      let lastUid = mb.lastUid;
      if (
        currentUidValidity &&
        mb.uidValidity &&
        mb.uidValidity !== currentUidValidity
      ) {
        lastUid = 0;
      }

      let maxUid = lastUid;
      const range = `${lastUid + 1}:*`;

      for await (const msg of client.fetch(
        range,
        { uid: true, source: true, envelope: true, internalDate: true },
        { uid: true },
      )) {
        const uid = msg.uid;
        // O range "N:*" pode retornar a última mensagem mesmo quando N > maxUid.
        if (uid <= lastUid) continue;
        if (!msg.source) continue;

        // Idempotência: já existe essa mensagem (por UID) nesta caixa?
        const already = await db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(eq(messages.mailboxId, mb.id), eq(messages.imapUid, uid)),
          )
          .limit(1);
        if (already.length > 0) {
          if (uid > maxUid) maxUid = uid;
          continue;
        }

        const parsed = await simpleParser(msg.source);
        const row = toMessageRow(parsed, uid, mb.id);
        const customerAddr = extractEmail(row.fromAddr);
        const referencedIds = parseReferencedIds(
          row.inReplyTo,
          row.referencesHeader,
        );

        const threadId = await resolveThread({
          mailboxId: mb.id,
          subject: row.subject,
          customerAddr,
          referencedIds,
        });

        const inserted = await db
          .insert(messages)
          .values({ ...row, threadId })
          .onConflictDoNothing()
          .returning({ id: messages.id });

        if (inserted.length > 0) {
          fetched++;
          // Mensagem nova do cliente: atualiza a thread e reabre se resolvida.
          await db
            .update(threads)
            .set({
              lastMessageAt: row.sentAt ?? new Date(),
              customerAddr: customerAddr ?? undefined,
            })
            .where(eq(threads.id, threadId));
        }

        if (uid > maxUid) maxUid = uid;
      }

      // Persiste o novo ponteiro e o UIDVALIDITY atual.
      if (maxUid !== mb.lastUid || currentUidValidity !== mb.uidValidity) {
        await db
          .update(mailboxes)
          .set({ lastUid: maxUid, uidValidity: currentUidValidity })
          .where(eq(mailboxes.id, mb.id));
      }
    } finally {
      lock.release();
    }
    await client.logout();
    return { ...base, fetched, status: "ok" };
  } catch (err) {
    try {
      await client.logout();
    } catch {
      /* ignora erro de logout após falha */
    }
    return {
      ...base,
      fetched,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Processa todas as caixas ativas, gravando um log por caixa.
 */
export async function ingestAllMailboxes(): Promise<IngestResult[]> {
  const active = await db.select().from(mailboxes).where(eq(mailboxes.active, true));
  const results: IngestResult[] = [];

  for (const mb of active) {
    const started = Date.now();
    const result = await ingestMailbox(mb);
    const durationMs = Date.now() - started;

    await db.insert(ingestLogs).values({
      mailboxId: mb.id,
      status: result.status,
      fetched: result.fetched,
      message: result.error ?? null,
      durationMs,
    });

    results.push(result);
  }

  return results;
}
