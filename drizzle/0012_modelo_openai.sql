-- Troca do provedor de IA: DeepSeek -> OpenAI (gpt-6-luna).
--
-- A linha única de ai_settings guarda o modelo escolhido na tela da base.
-- Qualquer valor deepseek-* deixou de existir no código, então vira o novo
-- padrão. Os registros antigos em ai_actions.model ficam como estão: são
-- trilha de auditoria de qual modelo gerou cada rascunho.
--
-- IDEMPOTENTE: rodar de novo não muda nada.

ALTER TABLE "ai_settings" ALTER COLUMN "model" SET DEFAULT 'gpt-6-luna';--> statement-breakpoint
UPDATE "ai_settings" SET "model" = 'gpt-6-luna' WHERE "model" LIKE 'deepseek%';
