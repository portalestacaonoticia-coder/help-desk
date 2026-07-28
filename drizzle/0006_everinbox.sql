-- Liga a operação de cada caixa a um projeto na Everinbox. É desse projeto que
-- o contato é removido quando pede descadastramento.
--
-- IDEMPOTENTE. Rodar ANTES do deploy: o código passa a selecionar esta coluna.

ALTER TABLE "mailboxes" ADD COLUMN IF NOT EXISTS "everinbox_project_id" text;
