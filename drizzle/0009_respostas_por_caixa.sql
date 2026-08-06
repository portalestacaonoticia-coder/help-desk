-- Resposta pronta por caixa de entrada. Sem isso a aba mistura o texto de
-- todas as marcas na mesma lista, e o agente escolhe no olho.
--
-- IDEMPOTENTE. Pode ser colada direto no SQL Editor do Neon, e deve rodar
-- ANTES do deploy que a acompanha — o código passa a selecionar
-- macros.mailbox_id.
--
-- A coluna nasce nullable de propósito: as respostas já cadastradas não têm
-- caixa e continuam valendo para todas. O campo é obrigatório no formulário,
-- então só o legado fica sem caixa.

ALTER TABLE "macros" ADD COLUMN IF NOT EXISTS "mailbox_id" integer;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "macros" ADD CONSTRAINT "macros_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "macros_mailbox_idx" ON "macros" USING btree ("mailbox_id");
