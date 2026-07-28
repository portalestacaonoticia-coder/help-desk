-- Assinatura e site passam a ser por caixa: cada operação assina com o nome
-- dela e aponta o próprio site, de onde a IA vai ler o sitemap.
--
-- IDEMPOTENTE. As colunas antigas de ai_settings NÃO são derrubadas aqui de
-- propósito: se o DROP rodar antes do deploy, o código publicado ainda as
-- seleciona e a tela quebra. Ver a nota no fim do arquivo.

ALTER TABLE "mailboxes" ADD COLUMN IF NOT EXISTS "signature" text;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN IF NOT EXISTS "site_url" text;--> statement-breakpoint

-- Herda a assinatura global que existia em ai_settings, se houver.
DO $$ BEGIN
	UPDATE "mailboxes" m
		SET "signature" = s."signature"
		FROM "ai_settings" s
		WHERE s."id" = 1
			AND m."signature" IS NULL
			AND s."signature" IS NOT NULL
			AND s."signature" <> '';
EXCEPTION
	WHEN undefined_column THEN NULL;
END $$;

-- Limpeza opcional, SÓ DEPOIS que o deploy que remove esses campos estiver no
-- ar. Rodar antes derruba a tela da base de conhecimento.
--
--   ALTER TABLE "ai_settings" DROP COLUMN IF EXISTS "temperature";
--   ALTER TABLE "ai_settings" DROP COLUMN IF EXISTS "confidence_threshold";
--   ALTER TABLE "ai_settings" DROP COLUMN IF EXISTS "signature";
