-- Fecha os chamados que a IA já respondeu sozinha antes desta regra existir.
--
-- Daqui em diante quem fecha é o próprio envio automático (ver
-- suggestReplyForMessage em src/lib/ai.ts). Esta migration é só o passado:
-- os chamados auto-respondidos até agora ficaram "aberto" e enchem a fila.
--
-- CRITÉRIO: a ÚLTIMA mensagem da thread é outbound sem usuário — a mesma
-- convenção do selo "Respondido Automaticamente" na fila. Outbound com
-- sent_by_user_id é resposta de agente, e a ingestão IMAP só grava inbound,
-- então nulo aqui significa IA e nada mais.
--
-- Fecha SÓ o que a IA respondeu por último. Thread em que um agente escreveu
-- depois fica como está — ali houve trabalho humano que pode seguir em curso.
--
-- IDEMPOTENTE e REVERSÍVEL: rodar de novo não muda nada (o filtro exige
-- 'aberto'), e mensagem nova do cliente reabre o chamado na ingestão.
--
-- Para conferir o tamanho ANTES de aplicar, troque o UPDATE por:
--   select count(*) from threads t where t.status = 'aberto' and (...);

UPDATE "threads" t
SET "status" = 'fechado'
WHERE t."status" = 'aberto'
  AND (
    SELECT m."direction" = 'outbound' AND m."sent_by_user_id" IS NULL
    FROM "messages" m
    WHERE m."thread_id" = t."id"
    ORDER BY m."created_at" DESC
    LIMIT 1
  );
