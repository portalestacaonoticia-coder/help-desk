-- Uma caixa pode atender vários projetos na Everinbox. O campo passa de um id
-- só para uma lista separada por vírgula.
--
-- IDEMPOTENTE. Rodar ANTES do deploy: o código passa a selecionar a coluna
-- nova, e `select().from(mailboxes)` pede todas as colunas do schema.

ALTER TABLE "mailboxes" ADD COLUMN IF NOT EXISTS "everinbox_project_ids" text;--> statement-breakpoint

-- Herda o projeto único que já estava configurado.
UPDATE "mailboxes"
	SET "everinbox_project_ids" = "everinbox_project_id"
	WHERE "everinbox_project_ids" IS NULL
		AND "everinbox_project_id" IS NOT NULL
		AND "everinbox_project_id" <> '';

-- A coluna antiga fica órfã de propósito: derrubá-la agora quebraria o código
-- que ainda estiver no ar. Opcional, depois do deploy:
--   ALTER TABLE "mailboxes" DROP COLUMN IF EXISTS "everinbox_project_id";
