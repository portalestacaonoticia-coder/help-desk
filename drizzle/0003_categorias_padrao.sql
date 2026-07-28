-- Categorias usadas na triagem dos chamados. Alimentam o select da tela de
-- chamado e a classificação da IA (categories.description é o que o modelo lê).
--
-- IDEMPOTENTE: o ON CONFLICT usa o índice único categories_name_uq, então
-- reaplicar não duplica nem sobrescreve descrição editada na tela da base.

INSERT INTO "categories" ("name", "description", "active") VALUES
	('Interesse', 'Cliente em potencial pedindo informação, proposta, preço ou querendo contratar.', true),
	('Reclamação', 'Cliente insatisfeito relatando problema, falha, cobrança indevida ou má experiência.', true),
	('Cancelamento', 'Cliente pedindo para encerrar contrato, assinatura ou serviço.', true)
ON CONFLICT ("name") DO NOTHING;
