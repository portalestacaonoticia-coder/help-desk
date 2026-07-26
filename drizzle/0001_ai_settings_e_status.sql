-- Fases 3-4 (IA) + simplificação dos status para aberto | fechado.
--
-- Escrita à mão e IDEMPOTENTE (IF NOT EXISTS / IF EXISTS em tudo): pode ser
-- reaplicada sem erro, e pode ser colada direto no SQL Editor do Neon.

-- ---------------------------------------------------------------
-- Configuração global da IA (linha única, id = 1)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"model" text DEFAULT 'deepseek-v4-flash' NOT NULL,
	"base_prompt" text DEFAULT '' NOT NULL,
	"signature" text,
	"temperature" real DEFAULT 0.3 NOT NULL,
	"confidence_threshold" real DEFAULT 0.75 NOT NULL,
	"auto_send_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------
-- categories: descrição (lida pela IA) e ativação
-- ---------------------------------------------------------------
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------
-- knowledge_base: palavras-chave, ativação e updated_at
-- ---------------------------------------------------------------
ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS "keywords" text;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_base_category_idx" ON "knowledge_base" USING btree ("category_id");--> statement-breakpoint

-- ---------------------------------------------------------------
-- ai_actions: rascunho, custo e trilha de auditoria
-- ---------------------------------------------------------------
ALTER TABLE "ai_actions" ADD COLUMN IF NOT EXISTS "thread_id" integer;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD COLUMN IF NOT EXISTS "summary" text;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD COLUMN IF NOT EXISTS "source_article_ids" text;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD COLUMN IF NOT EXISTS "model" text;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD COLUMN IF NOT EXISTS "prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD COLUMN IF NOT EXISTS "completion_tokens" integer;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD COLUMN IF NOT EXISTS "error_message" text;--> statement-breakpoint
ALTER TABLE "ai_actions" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pendente' NOT NULL;--> statement-breakpoint

-- numeric -> real: a tabela nasceu vazia (Fase 3-4 nunca rodou), sem risco de perda.
ALTER TABLE "ai_actions" ALTER COLUMN "confidence" TYPE real USING "confidence"::real;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_thread_id_threads_id_fk"
		FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id")
		ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_actions_thread_idx" ON "ai_actions" USING btree ("thread_id");--> statement-breakpoint

-- Antes do índice único: remove análises duplicadas da mesma mensagem, se houver.
DELETE FROM "ai_actions" a USING "ai_actions" b
	WHERE a.id > b.id AND a.message_id IS NOT DISTINCT FROM b.message_id
	AND a.message_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_actions_message_uq" ON "ai_actions" USING btree ("message_id");--> statement-breakpoint

-- ---------------------------------------------------------------
-- threads.status: 4 valores -> aberto | fechado
-- ---------------------------------------------------------------
ALTER TABLE "threads" ALTER COLUMN "status" SET DEFAULT 'aberto';--> statement-breakpoint

UPDATE "threads" SET "status" = 'aberto'
	WHERE "status" IN ('novo', 'em_andamento', 'aguardando_cliente');--> statement-breakpoint
UPDATE "threads" SET "status" = 'fechado' WHERE "status" = 'resolvido';--> statement-breakpoint

-- ---------------------------------------------------------------
-- Atribuição de responsável foi removida do produto.
--
-- DESTRUTIVO: apaga quem estava atribuído em cada chamado. Se quiser
-- preservar esse histórico, remova as duas linhas abaixo antes de aplicar —
-- a coluna órfã não quebra nada, o código simplesmente para de lê-la.
-- ---------------------------------------------------------------
ALTER TABLE "threads" DROP CONSTRAINT IF EXISTS "threads_assigned_agent_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "threads" DROP COLUMN IF EXISTS "assigned_agent_id";
