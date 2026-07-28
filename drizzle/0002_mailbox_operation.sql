-- Nome da operação/área que usa cada caixa. É o rótulo mostrado na navegação.
--
-- Escrita à mão e IDEMPOTENTE: pode ser reaplicada sem erro, e pode ser colada
-- direto no SQL Editor do Neon.

ALTER TABLE "mailboxes" ADD COLUMN IF NOT EXISTS "operation" text;--> statement-breakpoint

-- Caixas já cadastradas herdam o rótulo como nome da operação.
UPDATE "mailboxes" SET "operation" = "label" WHERE "operation" IS NULL;
