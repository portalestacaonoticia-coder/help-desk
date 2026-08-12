-- Resposta automática por caixa e por idioma.
--
-- O prompt do envio automático é um só, geral para todas as caixas. O texto
-- que chega ao cliente não: cada operação tem o seu, e a mesma operação
-- atende em português, espanhol e inglês. Esta tabela guarda esse texto.
--
-- IDEMPOTENTE. Pode ser colada direto no SQL Editor do Neon, e deve rodar
-- ANTES do deploy que a acompanha — o código passa a ler auto_replies ao
-- montar o prompt da IA.
--
-- O índice único (mailbox_id, language) é o que garante um texto por idioma
-- por caixa: salvar o mesmo par de novo substitui, não duplica.

CREATE TABLE IF NOT EXISTS "auto_replies" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox_id" integer NOT NULL,
	"language" text NOT NULL,
	"body" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "auto_replies" ADD CONSTRAINT "auto_replies_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "auto_replies_mailbox_idx" ON "auto_replies" USING btree ("mailbox_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "auto_replies_mailbox_lang_uq" ON "auto_replies" USING btree ("mailbox_id","language");
