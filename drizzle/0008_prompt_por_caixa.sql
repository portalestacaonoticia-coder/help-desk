-- Instruções de IA por caixa. É o que resolve o idioma: cada operação tem o
-- seu (português, espanhol, inglês) sem precisar de um prompt global que tente
-- servir a todos.
--
-- IDEMPOTENTE. Rodar ANTES do deploy: o código passa a selecionar a coluna, e
-- `select().from(mailboxes)` pede todas as colunas do schema.

ALTER TABLE "mailboxes" ADD COLUMN IF NOT EXISTS "ai_prompt" text;
