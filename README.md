# Help Desk — Tihee

Central própria de suporte por e-mail: ingere as caixas de suporte (IMAP),
agrupa em tickets e permite que a equipe responda pelo dashboard (SMTP da
própria caixa de origem). A IA (DeepSeek) lê cada e-mail novo e prepara um
rascunho de resposta a partir da base de conhecimento — **sempre rascunho**:
nada sai para o cliente sem um clique do agente.

## Estado atual

- **Fase 0** — Setup (Next.js App Router + TS, Drizzle, Postgres, cron). ✅
- **Fase 1** — Ingestão IMAP idempotente das caixas, com threading e log por caixa. ✅
- **Fase 2** — Auth, dashboard (lista + ticket), resposta via SMTP, atribuição, macros. ✅
- **Fase 3** — Base de conhecimento, categorias e prompt base editáveis. ✅
- **Fase 4** — Classificação e rascunho de resposta via DeepSeek, com trilha em `ai_actions`. ✅
- **Fase 5** — Alertas de cron, métricas e dashboard. ⏳

## Stack

Next.js 15 · Drizzle ORM · Postgres (Neon em prod / Docker em dev) · imapflow +
mailparser · Nodemailer · Auth.js v5 · DeepSeek · Vercel Cron.

## Como a IA funciona

A cada 2 minutos o cron ingere os e-mails novos e, na sequência, chama
`processPendingMessages()` para cada mensagem recebida que ainda não foi
analisada. Para cada uma:

1. Rankeia os artigos da base de conhecimento por sobreposição de termos com o
   e-mail (busca lexical, sem embeddings — custo zero e suficiente para uma KB
   interna).
2. Monta o prompt: prompt base + categorias + até 6 artigos + histórico da thread.
3. Chama o DeepSeek em modo JSON e grava categoria, confiança, resumo e rascunho
   em `ai_actions`.

O rascunho aparece no chamado como o card "Sugestão de resposta", com as fontes
usadas. O agente pode aproveitar, regenerar ou descartar. **A IA nunca envia
e-mail**: `ai_settings.auto_send_enabled` e `categories.auto_respondivel` existem
no schema para um rollout futuro, mas nenhum código de envio automático lê esses
campos hoje.

Sem `DEEPSEEK_API_KEY` a aplicação roda normalmente — só não gera rascunhos, e a
base de conhecimento continua editável.

## Rodando localmente

```bash
# 1. Sobe o Postgres local (porta 5434 no host)
npm run db:up

# 2. Instala dependências
npm install

# 3. Copia e ajusta as variáveis de ambiente
cp .env.example .env.local   # já vem preenchido para dev

# 4. Cria as tabelas
npm run db:migrate

# 5. Cria o usuário admin + macros de exemplo
npm run seed
#   Admin padrão de dev: admin@tihee.com.br / changeme123  (TROCAR)

# 6. Sobe a aplicação
npm run dev   # http://localhost:3000
```

### Cadastrar as 6 caixas (credenciais cifradas)

O jeito normal é pela tela **Caixas de e-mail** (`/caixas`, só admin), que
cadastra, edita e testa a conexão IMAP/SMTP. As senhas são cifradas com
AES-256-GCM antes de ir ao banco, e editar sem preencher a senha mantém a que
já está gravada.

Para cadastro em lote, o script continua funcionando:

```bash
MB_LABEL="Suporte" \
MB_IMAP_HOST=mail.seudominio.com.br MB_IMAP_USER=suporte@seudominio.com.br MB_IMAP_PASS='senha' \
MB_SMTP_HOST=mail.seudominio.com.br \
npx tsx scripts/add-mailbox.ts
```

Portas default: IMAP 993 (TLS), SMTP 465 (TLS). Ajuste com `MB_IMAP_PORT`,
`MB_SMTP_PORT`, `MB_IMAP_TLS=false`, etc.

### Testar a ingestão manualmente

```bash
npm run ingest   # conecta em todas as caixas ativas e grava as mensagens novas
```

Depois mande um e-mail de teste para a caixa e rode de novo — a mensagem deve
aparecer no dashboard. Rodar duas vezes **não** duplica (idempotente por
Message-ID / UID).

## Variáveis de ambiente

Ver `.env.example`. Destaques:

| Var | O quê |
|-----|-------|
| `DATABASE_URL` | Postgres. Dev: docker (5434). Prod: Neon (`?sslmode=require`). |
| `NEXTAUTH_SECRET` | Segredo de sessão do Auth.js. |
| `ENCRYPTION_KEY` | 32 bytes base64. Cifra as senhas das caixas. **Trocar invalida as senhas cifradas.** |
| `CRON_SECRET` | Protege `/api/cron/ingest`. O Vercel envia como `Bearer`. |
| `DEEPSEEK_API_KEY` | Rascunhos da IA. Sem ela a app roda, só não sugere. |

As caixas **não** ficam em env — ficam na tabela `mailboxes` (senhas cifradas).

## Cron de ingestão

`vercel.json` agenda `GET /api/cron/ingest` a cada 2 min. Cada execução grava
uma linha em `ingest_logs` por caixa (status ok/erro, quantidade, duração) — é
por aí que se detecta caixa fora do ar (a base para os alertas da Fase 5).

## Estrutura

```
src/
  db/            schema Drizzle, conexão, migrate
  lib/
    crypto.ts    AES-256-GCM (senhas das caixas)
    imap.ts      ingestão (imapflow + mailparser + threading)
    threading.ts normalização de assunto / agrupamento
    smtp.ts      envio de resposta (Nodemailer)
    auth.ts      Auth.js v5 (credenciais)
    deepseek.ts  cliente da API do DeepSeek (chat completions + JSON mode)
    ai.ts        prompt, ranking da KB, classificação e rascunho
    ui.ts        helpers de formatação da interface
  app/
    login/       tela de login
    tickets/     lista + [id] (thread, resposta, sugestão da IA, atribuição)
    base/        base de conhecimento, categorias e prompt base
    caixas/      CRUD das caixas + teste de conexão + status do ingest
    macros/      respostas prontas
    api/cron/ingest  endpoint do Vercel Cron (ingestão + rascunhos)
    actions.ts   server actions (login, reply, assign, KB, caixas, sugestões)
scripts/         seed, add-mailbox, ingest-once
```

## Deploy (Vercel + Neon)

1. Criar projeto no Neon → copiar a connection string para `DATABASE_URL`
   (com `?sslmode=require`).
2. Rodar `npm run db:migrate` apontando para o Neon.
3. Definir as env vars no Vercel (mesmas do `.env.local`, com segredos de prod).
4. Deploy. O Vercel Cron passa a chamar a ingestão automaticamente.
5. Cadastrar as caixas (`add-mailbox`) e criar o admin (`seed`).

## Status dos chamados

Só existem dois: **aberto** e **fechado**.

- Chamado nasce `aberto` na ingestão.
- Responder ao cliente **não** fecha — quem fecha é o agente, pelo seletor.
- Resposta nova do cliente reabre um chamado fechado (`lib/imap.ts`), para não
  ficar invisível na fila.

Se o banco tiver dados dos 4 status antigos (`novo`, `em_andamento`,
`aguardando_cliente`, `resolvido`), rode uma vez:

```bash
npm run migrate:status   # novo/em_andamento/aguardando_cliente -> aberto; resolvido -> fechado
```

O script é idempotente e imprime a contagem antes e depois.

## Próximos passos

- Levantar com a Letícia as categorias reais e escrever os primeiros artigos —
  a qualidade do rascunho depende inteiramente da base de conhecimento.
- Calibrar o limiar de confiança olhando `ai_actions` (quantas sugestões foram
  marcadas `usada` vs `descartada`).
- Fase 5: dashboard de métricas, alertas quando uma caixa falha no cron,
  retry/rate-limit na chamada ao DeepSeek.
- Só depois disso avaliar ligar o envio automático, categoria a categoria.
