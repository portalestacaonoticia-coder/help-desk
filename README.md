# Help Desk — Tihee

Central própria de suporte por e-mail: ingere as caixas de suporte (IMAP),
agrupa em tickets e permite que a equipe responda pelo dashboard (SMTP da
própria caixa de origem). As Fases 3–4 (classificação e auto-resposta por IA)
ainda **não** estão implementadas — o schema já existe, mas sem lógica/UI.

## Estado atual

- **Fase 0** — Setup (Next.js App Router + TS, Drizzle, Postgres, cron). ✅
- **Fase 1** — Ingestão IMAP idempotente das caixas, com threading e log por caixa. ✅
- **Fase 2** — Auth, dashboard (lista + ticket), resposta via SMTP, atribuição, macros. ✅
- **Fases 3–4** — IA. ⏳ (tabelas `categories`, `knowledge_base`, `ai_actions` já criadas)

## Stack

Next.js 15 · Drizzle ORM · Postgres (Neon em prod / Docker em dev) · imapflow +
mailparser · Nodemailer · Auth.js v5 · Vercel Cron.

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

Enquanto o CRUD de caixas pelo dashboard não é usado, use o script — as senhas
são cifradas com AES-256-GCM antes de ir ao banco:

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
| `ANTHROPIC_API_KEY` | Só nas Fases 3–4. Vazio por enquanto. |

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
  app/
    login/       tela de login
    tickets/     lista + [id] (thread, resposta, status, atribuição)
    macros/      respostas prontas
    api/cron/ingest  endpoint do Vercel Cron
    actions.ts   server actions (login, reply, assign, status, macro)
scripts/         seed, add-mailbox, ingest-once
```

## Deploy (Vercel + Neon)

1. Criar projeto no Neon → copiar a connection string para `DATABASE_URL`
   (com `?sslmode=require`).
2. Rodar `npm run db:migrate` apontando para o Neon.
3. Definir as env vars no Vercel (mesmas do `.env.local`, com segredos de prod).
4. Deploy. O Vercel Cron passa a chamar a ingestão automaticamente.
5. Cadastrar as caixas (`add-mailbox`) e criar o admin (`seed`).

## Próximos passos (Fases 3–5)

- Levantar com a Letícia as categorias reais e o limiar de confiança inicial.
- Fase 3: UI de `knowledge_base` e `categories` (marcar `auto_respondivel`).
- Fase 4: worker de classificação + auto-resposta com log em `ai_actions`.
- Fase 5: alertas de cron, métricas, retry/rate-limit.
