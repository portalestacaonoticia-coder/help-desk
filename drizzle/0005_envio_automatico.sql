-- Prompt dedicado ao envio automático + categoria "Sem Resposta".
--
-- IDEMPOTENTE. Pode ser colada direto no SQL Editor do Neon, e deve rodar
-- ANTES do deploy que a acompanha — o código passa a selecionar
-- ai_settings.auto_send_prompt.

ALTER TABLE "ai_settings" ADD COLUMN IF NOT EXISTS "auto_send_prompt" text NOT NULL DEFAULT '';--> statement-breakpoint

INSERT INTO "categories" ("name", "description", "active") VALUES
	('Sem Resposta', 'Nada a responder: e-mail automático, retorno vazio, fora de contexto ou que dispensa retorno.', true)
ON CONFLICT ("name") DO NOTHING;
