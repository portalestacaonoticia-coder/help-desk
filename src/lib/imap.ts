import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { and, eq, inArray, desc, gte, sql } from "drizzle-orm";
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

// Teto de mensagens por execução. Caixa nova tem milhares de e-mails e baixar
// tudo de uma vez estoura o maxDuration da função — o cron drena aos poucos.
const MAX_MESSAGES_PER_RUN = 200;

// Orçamento de tempo por caixa, abaixo do maxDuration=60s da rota de cron.
// Ao estourar, o loop para e o progresso já está salvo (ver checkpoint abaixo).
// Folga para o encerramento da conexão e a gravação do log depois do loop.
const TIME_BUDGET_MS = 30_000;

// Teto de espera pelo logout educado antes de derrubar o socket.
const LOGOUT_TIMEOUT_MS = 3_000;

// A cada N mensagens grava o ponteiro. Sem isso, uma execução interrompida
// perde todo o trabalho e a próxima recomeça do mesmo UID, para sempre.
const CHECKPOINT_EVERY = 20;

/**
 * Encontra (ou cria) a thread à qual uma mensagem recebida pertence.
 * `created` diz se a thread nasceu agora — quem chama precisa saber para
 * desfazer a criação se a mensagem acabar não entrando.
 */
async function resolveThread(params: {
  mailboxId: number;
  subject: string | null;
  customerAddr: string | null;
  referencedIds: string[];
}): Promise<{ id: number; created: boolean }> {
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
    if (parent.length > 0) return { id: parent[0].threadId, created: false };
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
    if (existing.length > 0) return { id: existing[0].id, created: false };
  }

  // 3) Nova thread.
  const [created] = await db
    .insert(threads)
    .values({
      mailboxId,
      subject: subject ?? null,
      subjectNormalized: subjectNormalized || null,
      customerAddr,
      status: "aberto",
    })
    .returning({ id: threads.id });
  return { id: created.id, created: true };
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
 * Encerra a conexão sem risco de pendurar a função.
 *
 * `logout()` é um comando IMAP: ele espera a resposta do servidor. Quando o
 * socket já morreu — o caso da HostGator derrubando a conexão no meio — essa
 * espera nunca termina, a função estoura o maxDuration e é morta ANTES de
 * gravar o ingest_log. Foi o que produziu o buraco entre "último e-mail
 * entrou" e "última ingestão": o trabalho acontecia, o registro não.
 */
async function disconnect(client: ImapFlow): Promise<void> {
  try {
    await Promise.race([
      client.logout(),
      new Promise<void>((resolve) => setTimeout(resolve, LOGOUT_TIMEOUT_MS)),
    ]);
  } catch {
    /* servidor sumiu; close() abaixo resolve */
  }
  try {
    // Derruba o socket na marra — não espera resposta de ninguém.
    client.close();
  } catch {
    /* já estava fechado */
  }
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
  const startedAt = Date.now();
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
      let persistedUid = mb.lastUid;
      const range = `${lastUid + 1}:*`;

      // Grava o ponteiro no meio do caminho para que uma execução interrompida
      // (timeout, queda do socket) não perca o que já foi processado.
      const checkpoint = async () => {
        if (maxUid === persistedUid && currentUidValidity === mb.uidValidity) {
          return;
        }
        await db
          .update(mailboxes)
          .set({ lastUid: maxUid, uidValidity: currentUidValidity })
          .where(eq(mailboxes.id, mb.id));
        persistedUid = maxUid;
      };

      let processed = 0;
      try {
        for await (const msg of client.fetch(
          range,
          { uid: true, source: true, envelope: true, internalDate: true },
          { uid: true },
        )) {
          // Para antes de estourar o tempo da função. O `break` fecha o fetch
          // e o que já foi lido fica salvo pelo checkpoint do finally.
          if (
            processed >= MAX_MESSAGES_PER_RUN ||
            Date.now() - startedAt > TIME_BUDGET_MS
          ) {
            break;
          }

          const uid = msg.uid;
          // O range "N:*" pode retornar a última mensagem mesmo quando N > maxUid.
          if (uid <= lastUid) continue;
          if (!msg.source) continue;

          processed++;

          // Idempotência: já existe essa mensagem (por UID) nesta caixa?
          const already = await db
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.mailboxId, mb.id), eq(messages.imapUid, uid)))
            .limit(1);
          if (already.length > 0) {
            if (uid > maxUid) maxUid = uid;
            if (processed % CHECKPOINT_EVERY === 0) await checkpoint();
            continue;
          }

          const parsed = await simpleParser(msg.source);
          const row = toMessageRow(parsed, uid, mb.id);
          const customerAddr = extractEmail(row.fromAddr);
          const referencedIds = parseReferencedIds(
            row.inReplyTo,
            row.referencesHeader,
          );

          // Segunda checagem de idempotência, agora por Message-ID: a mesma
          // mensagem pode aparecer em dois UIDs. Sem isto o thread nasce, o
          // insert bate no índice único e sobra um chamado com 0 mensagens.
          if (row.messageIdHeader) {
            const dup = await db
              .select({ id: messages.id })
              .from(messages)
              .where(
                and(
                  eq(messages.mailboxId, mb.id),
                  eq(messages.messageIdHeader, row.messageIdHeader),
                ),
              )
              .limit(1);
            if (dup.length > 0) {
              if (uid > maxUid) maxUid = uid;
              if (processed % CHECKPOINT_EVERY === 0) await checkpoint();
              continue;
            }
          }

          const thread = await resolveThread({
            mailboxId: mb.id,
            subject: row.subject,
            customerAddr,
            referencedIds,
          });
          const threadId = thread.id;

          const inserted = await db
            .insert(messages)
            .values({ ...row, threadId })
            .onConflictDoNothing()
            .returning({ id: messages.id });

          // Perdeu uma corrida com outra execução: desfaz a thread recém-criada
          // em vez de deixar um chamado vazio na fila.
          if (inserted.length === 0 && thread.created) {
            await db.delete(threads).where(eq(threads.id, threadId));
          }

          if (inserted.length > 0) {
            fetched++;
            // Mensagem nova do cliente reabre o chamado: se já estava fechado,
            // volta para a fila em vez de ficar invisível para a equipe.
            await db
              .update(threads)
              .set({
                lastMessageAt: row.sentAt ?? new Date(),
                customerAddr: customerAddr ?? undefined,
                status: sql`'aberto'`,
              })
              .where(eq(threads.id, threadId));
          }

          if (uid > maxUid) maxUid = uid;
          if (processed % CHECKPOINT_EVERY === 0) await checkpoint();
        }
      } finally {
        // Vale também para o caminho de erro: o socket pode cair no meio do
        // loop, e o que já entrou no banco tem que ficar registrado.
        await checkpoint().catch(() => {
          /* não mascara o erro original */
        });
      }
    } finally {
      lock.release();
    }
    await disconnect(client);
    return { ...base, fetched, status: "ok" };
  } catch (err) {
    await disconnect(client);
    return {
      ...base,
      fetched,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Testa as credenciais IMAP de uma caixa sem ler mensagens.
 * Usado pelo botão "testar conexão" da tela de caixas.
 */
export async function verifyImap(mb: Mailbox): Promise<void> {
  const client = new ImapFlow({
    host: mb.imapHost,
    port: mb.imapPort,
    secure: mb.imapTls,
    auth: { user: mb.imapUser, pass: decryptSecret(mb.imapPassEnc) },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    lock.release();
  } finally {
    await disconnect(client);
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
