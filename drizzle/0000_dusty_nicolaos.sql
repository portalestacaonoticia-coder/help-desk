CREATE TABLE "ai_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer,
	"category_suggested" text,
	"confidence" numeric,
	"action_taken" text,
	"response_sent" text,
	"reviewed" boolean DEFAULT false NOT NULL,
	"review_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"auto_respondivel" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox_id" integer,
	"status" text NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"message" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_base" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer,
	"title" text,
	"content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "macros" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"shortcut" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_user" text NOT NULL,
	"imap_pass_enc" text NOT NULL,
	"imap_tls" boolean DEFAULT true NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 465 NOT NULL,
	"smtp_user" text NOT NULL,
	"smtp_pass_enc" text NOT NULL,
	"smtp_tls" boolean DEFAULT true NOT NULL,
	"from_address" text,
	"last_uid" integer DEFAULT 0 NOT NULL,
	"uid_validity" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"mailbox_id" integer NOT NULL,
	"direction" text NOT NULL,
	"message_id_header" text,
	"in_reply_to" text,
	"references_header" text,
	"from_addr" text,
	"to_addr" text,
	"subject" text,
	"body_text" text,
	"body_html" text,
	"imap_uid" integer,
	"sent_by_user_id" integer,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailbox_id" integer NOT NULL,
	"subject" text,
	"subject_normalized" text,
	"customer_addr" text,
	"status" text DEFAULT 'novo' NOT NULL,
	"assigned_agent_id" integer,
	"category" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'agent' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_logs" ADD CONSTRAINT "ingest_logs_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_assigned_agent_id_users_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_uq" ON "categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "ingest_logs_mailbox_idx" ON "ingest_logs" USING btree ("mailbox_id");--> statement-breakpoint
CREATE INDEX "ingest_logs_created_idx" ON "ingest_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_mailbox_msgid_uq" ON "messages" USING btree ("mailbox_id","message_id_header");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_mailbox_uid_uq" ON "messages" USING btree ("mailbox_id","imap_uid");--> statement-breakpoint
CREATE INDEX "threads_mailbox_idx" ON "threads" USING btree ("mailbox_id");--> statement-breakpoint
CREATE INDEX "threads_status_idx" ON "threads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "threads_last_msg_idx" ON "threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "threads_subjnorm_idx" ON "threads" USING btree ("mailbox_id","subject_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");