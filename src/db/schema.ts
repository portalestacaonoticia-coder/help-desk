import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Caixas de e-mail (IMAP/SMTP). Uma linha por caixa de suporte.
 * As senhas ficam CIFRADAS (AES-256-GCM) em *_pass_enc — ver src/lib/crypto.ts.
 * Nunca gravar senha em texto puro aqui.
 */
export const mailboxes = pgTable("mailboxes", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),

  imapHost: text("imap_host").notNull(),
  imapPort: integer("imap_port").notNull().default(993),
  imapUser: text("imap_user").notNull(),
  imapPassEnc: text("imap_pass_enc").notNull(),
  imapTls: boolean("imap_tls").notNull().default(true),

  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull().default(465),
  smtpUser: text("smtp_user").notNull(),
  smtpPassEnc: text("smtp_pass_enc").notNull(),
  smtpTls: boolean("smtp_tls").notNull().default(true),

  // Endereço "From" usado ao responder (default: imapUser).
  fromAddress: text("from_address"),

  // Último UID processado na pasta INBOX (idempotência da ingestão).
  lastUid: integer("last_uid").notNull().default(0),
  // UIDVALIDITY do IMAP: se mudar, os UIDs foram reciclados e last_uid deve resetar.
  uidValidity: text("uid_validity"),

  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Usuários do dashboard (você + 1-2 agentes).
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("agent"), // admin | agent
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("users_email_uq").on(t.email),
]);

/**
 * Thread = conversa agrupada (uma "solicitação" do cliente).
 */
export const threads = pgTable("threads", {
  id: serial("id").primaryKey(),
  mailboxId: integer("mailbox_id").notNull().references(() => mailboxes.id),
  subject: text("subject"),
  // Assunto normalizado (sem Re:/Fwd:, minúsculo) para agrupar por assunto.
  subjectNormalized: text("subject_normalized"),
  // Endereço do cliente (contraparte), para busca e agrupamento.
  customerAddr: text("customer_addr"),

  status: text("status").notNull().default("novo"), // novo | em_andamento | aguardando_cliente | resolvido
  assignedAgentId: integer("assigned_agent_id").references(() => users.id),
  category: text("category"),

  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("threads_mailbox_idx").on(t.mailboxId),
  index("threads_status_idx").on(t.status),
  index("threads_last_msg_idx").on(t.lastMessageAt),
  index("threads_subjnorm_idx").on(t.mailboxId, t.subjectNormalized),
]);

/**
 * Mensagem individual dentro de uma thread.
 * direction: inbound (recebida do cliente) | outbound (enviada por agente/IA).
 */
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => threads.id),
  mailboxId: integer("mailbox_id").notNull().references(() => mailboxes.id),
  direction: text("direction").notNull(), // inbound | outbound

  // Cabeçalho Message-ID (chave natural de deduplicação entre execuções).
  messageIdHeader: text("message_id_header"),
  inReplyTo: text("in_reply_to"),
  referencesHeader: text("references_header"),

  fromAddr: text("from_addr"),
  toAddr: text("to_addr"),
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),

  // UID do IMAP na caixa de origem (para inbound).
  imapUid: integer("imap_uid"),

  // Quem enviou (para outbound feito por humano). Null = IA/sistema.
  sentByUserId: integer("sent_by_user_id").references(() => users.id),

  sentAt: timestamp("sent_at", { withTimezone: true }), // data real do e-mail
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("messages_thread_idx").on(t.threadId),
  // Idempotência: um mesmo Message-ID por caixa não pode duplicar.
  uniqueIndex("messages_mailbox_msgid_uq").on(t.mailboxId, t.messageIdHeader),
  // Fallback de idempotência quando não há Message-ID: UID por caixa.
  uniqueIndex("messages_mailbox_uid_uq").on(t.mailboxId, t.imapUid),
]);

/**
 * Respostas prontas / macros usadas pelos agentes.
 */
export const macros = pgTable("macros", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  shortcut: text("shortcut"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Log de cada execução do cron de ingestão, por caixa.
 * Essencial para detectar caixa fora do ar.
 */
export const ingestLogs = pgTable("ingest_logs", {
  id: serial("id").primaryKey(),
  mailboxId: integer("mailbox_id").references(() => mailboxes.id),
  status: text("status").notNull(), // ok | error
  fetched: integer("fetched").notNull().default(0),
  message: text("message"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ingest_logs_mailbox_idx").on(t.mailboxId),
  index("ingest_logs_created_idx").on(t.createdAt),
]);

/* ------------------------------------------------------------------ */
/* Tabelas das Fases 3-4 (IA). Criadas agora só como schema; sem UI    */
/* nem lógica ainda. Mantidas aqui para evitar migration extra depois. */
/* ------------------------------------------------------------------ */

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  autoRespondivel: boolean("auto_respondivel").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("categories_name_uq").on(t.name),
]);

export const knowledgeBase = pgTable("knowledge_base", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").references(() => categories.id),
  title: text("title"),
  content: text("content"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiActions = pgTable("ai_actions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").references(() => messages.id),
  categorySuggested: text("category_suggested"),
  confidence: numeric("confidence"),
  actionTaken: text("action_taken"), // respondeu_auto | escalou_humano
  responseSent: text("response_sent"),
  reviewed: boolean("reviewed").notNull().default(false),
  reviewResult: text("review_result"), // correta | errada
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Tipos inferidos, reaproveitados no resto do código.
export type Mailbox = typeof mailboxes.$inferSelect;
export type NewMailbox = typeof mailboxes.$inferInsert;
export type Thread = typeof threads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type User = typeof users.$inferSelect;
export type Macro = typeof macros.$inferSelect;
