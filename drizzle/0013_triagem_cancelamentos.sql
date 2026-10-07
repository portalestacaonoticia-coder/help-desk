-- Triagem de cancelamentos (tela /cancelamentos).
--
-- Guarda a decisão do agente por contato: descadastrado na Everinbox ou
-- ignorado. Nada é cancelado automaticamente — a tabela só evita que o mesmo
-- contato volte para a lista depois de tratado.

CREATE TABLE IF NOT EXISTS "contact_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox_id" integer NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"last_message_id" integer NOT NULL,
	"note" text,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_reviews" ADD CONSTRAINT "contact_reviews_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "contact_reviews" ADD CONSTRAINT "contact_reviews_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_reviews_mailbox_email_uq" ON "contact_reviews" USING btree ("mailbox_id","email");
