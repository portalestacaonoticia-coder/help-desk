import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  real,
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

  // aberto | fechado. Um chamado nasce aberto e só fecha por ação do agente;
  // resposta nova do cliente reabre (ver lib/imap.ts).
  status: text("status").notNull().default("aberto"),
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
/* Fases 3-4 — classificação e sugestão de resposta por IA (DeepSeek). */
/* ------------------------------------------------------------------ */

/**
 * Categorias de chamado. Alimentam a classificação da IA — `description`
 * é o que o modelo lê para decidir em qual categoria a mensagem se encaixa.
 *
 * `autoRespondivel` marca categorias cujo rascunho PODE ser enviado sem
 * revisão humana. Só tem efeito quando `ai_settings.auto_send_enabled` está
 * ligado; hoje a operação é 100% rascunho.
 */
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  autoRespondivel: boolean("auto_respondivel").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("categories_name_uq").on(t.name),
]);

/**
 * Artigos da base de conhecimento. São injetados no prompt da IA como
 * material de referência para redigir a resposta.
 */
export const knowledgeBase = pgTable("knowledge_base", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").references(() => categories.id),
  title: text("title"),
  content: text("content"),
  // Termos extras que ajudam a casar o artigo com o e-mail (separados por vírgula).
  keywords: text("keywords"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("knowledge_base_category_idx").on(t.categoryId),
]);

/**
 * Configuração global da IA — linha única (id = 1).
 * `basePrompt` é o prompt base que orienta o tom e as regras de resposta.
 */
export const aiSettings = pgTable("ai_settings", {
  id: integer("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(true),
  model: text("model").notNull().default("deepseek-v4-flash"),
  basePrompt: text("base_prompt").notNull().default(""),
  // Assinatura anexada ao final de toda resposta gerada.
  signature: text("signature"),
  temperature: real("temperature").notNull().default(0.3),
  // Abaixo deste limiar a IA não propõe categoria nem auto-envio (0 a 1).
  confidenceThreshold: real("confidence_threshold").notNull().default(0.75),
  // Trava mestra do envio automático. Off = tudo vira rascunho para revisão.
  autoSendEnabled: boolean("auto_send_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Uma linha por vez que a IA analisou uma mensagem recebida.
 * Serve de rascunho para o agente e de trilha de auditoria do que o modelo
 * sugeriu, com o que foi feito depois.
 */
export const aiActions = pgTable("ai_actions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").references(() => messages.id),
  threadId: integer("thread_id").references(() => threads.id),

  categorySuggested: text("category_suggested"),
  confidence: real("confidence"),
  // sugerido | auto_enviado | erro
  actionTaken: text("action_taken"),
  // Rascunho gerado pelo modelo (ou a resposta de fato enviada).
  responseSent: text("response_sent"),
  // Resumo do problema, mostrado ao agente antes de ele ler a thread inteira.
  summary: text("summary"),
  // Ids dos artigos da KB usados, separados por vírgula.
  sourceArticleIds: text("source_article_ids"),

  model: text("model"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  errorMessage: text("error_message"),

  // pendente | usada | descartada
  status: text("status").notNull().default("pendente"),
  reviewed: boolean("reviewed").notNull().default(false),
  reviewResult: text("review_result"), // correta | errada
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ai_actions_thread_idx").on(t.threadId),
  // Uma análise por mensagem — evita o cron reprocessar a mesma mensagem.
  uniqueIndex("ai_actions_message_uq").on(t.messageId),
]);

// Tipos inferidos, reaproveitados no resto do código.
export type Mailbox = typeof mailboxes.$inferSelect;
export type NewMailbox = typeof mailboxes.$inferInsert;
export type Thread = typeof threads.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type User = typeof users.$inferSelect;
export type Macro = typeof macros.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type KbArticle = typeof knowledgeBase.$inferSelect;
export type AiSettings = typeof aiSettings.$inferSelect;
export type AiAction = typeof aiActions.$inferSelect;
