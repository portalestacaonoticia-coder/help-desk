import { config } from "dotenv";
config({ path: ".env.local" });

import { ingestAllMailboxes } from "../src/lib/imap";

/**
 * Roda a ingestão uma vez a partir da linha de comando, para teste manual:
 *   npm run ingest
 */
async function main() {
  console.log("Iniciando ingestão de todas as caixas ativas…");
  const results = await ingestAllMailboxes();
  for (const r of results) {
    if (r.status === "ok") {
      console.log(`✓ [${r.label}] ${r.fetched} mensagem(ns) nova(s)`);
    } else {
      console.error(`✗ [${r.label}] ERRO: ${r.error}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Falha na ingestão:", err);
  process.exit(1);
});
