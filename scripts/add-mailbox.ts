import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/db";
import { mailboxes } from "../src/db/schema";
import { encryptSecret } from "../src/lib/crypto";

/**
 * Cadastra uma caixa de e-mail cifrando as senhas (AES-256-GCM).
 * Enquanto o CRUD do dashboard não é usado, este script é o jeito rápido de
 * adicionar as 6 caixas.
 *
 * Uso (via env vars, para não deixar senha no histórico do shell):
 *   MB_LABEL="Suporte" \
 *   MB_IMAP_HOST=mail.tihee.com.br MB_IMAP_USER=suporte@tihee.com.br MB_IMAP_PASS=... \
 *   MB_SMTP_HOST=mail.tihee.com.br MB_SMTP_USER=suporte@tihee.com.br MB_SMTP_PASS=... \
 *   npm run tsx scripts/add-mailbox.ts
 *
 * Ou:  npx tsx scripts/add-mailbox.ts
 */
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável ${name} obrigatória`);
  return v;
}

async function main() {
  const label = req("MB_LABEL");
  const imapHost = req("MB_IMAP_HOST");
  const imapUser = req("MB_IMAP_USER");
  const imapPass = req("MB_IMAP_PASS");
  const smtpHost = req("MB_SMTP_HOST");
  const smtpUser = process.env.MB_SMTP_USER ?? imapUser;
  const smtpPass = process.env.MB_SMTP_PASS ?? imapPass;

  await db.insert(mailboxes).values({
    label,
    imapHost,
    imapPort: Number(process.env.MB_IMAP_PORT ?? 993),
    imapUser,
    imapPassEnc: encryptSecret(imapPass),
    imapTls: (process.env.MB_IMAP_TLS ?? "true") !== "false",
    smtpHost,
    smtpPort: Number(process.env.MB_SMTP_PORT ?? 465),
    smtpUser,
    smtpPassEnc: encryptSecret(smtpPass),
    smtpTls: (process.env.MB_SMTP_TLS ?? "true") !== "false",
    fromAddress: process.env.MB_FROM ?? imapUser,
  });

  console.log(`✓ Caixa "${label}" cadastrada (credenciais cifradas).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Falha ao cadastrar caixa:", err);
  process.exit(1);
});
