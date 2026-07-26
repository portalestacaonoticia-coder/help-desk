import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";
import { db } from "../src/db";

/**
 * Converte os 4 status antigos para os 2 atuais (aberto | fechado).
 *
 *   novo, em_andamento, aguardando_cliente  ->  aberto
 *   resolvido                               ->  fechado
 *
 * Idempotente: rodar de novo não muda nada, porque só toca em linhas cujo
 * status ainda é um dos valores antigos.
 *
 *   npm run migrate:status
 */
async function main() {
  const before = await db.execute<{ status: string; n: number }>(
    sql`select status, count(*)::int as n from threads group by status order by status`,
  );

  console.log("Antes:");
  for (const r of before) console.log(`  ${r.status.padEnd(20)} ${r.n}`);

  const abertos = await db.execute(
    sql`update threads set status = 'aberto'
        where status in ('novo', 'em_andamento', 'aguardando_cliente')`,
  );
  const fechados = await db.execute(
    sql`update threads set status = 'fechado' where status = 'resolvido'`,
  );

  console.log(`\n-> ${abertos.count} chamados marcados como aberto`);
  console.log(`-> ${fechados.count} chamados marcados como fechado`);

  const after = await db.execute<{ status: string; n: number }>(
    sql`select status, count(*)::int as n from threads group by status order by status`,
  );

  console.log("\nDepois:");
  for (const r of after) console.log(`  ${r.status.padEnd(20)} ${r.n}`);

  const invalid = after.filter((r) => !["aberto", "fechado"].includes(r.status));
  if (invalid.length > 0) {
    console.error(
      `\n⚠ Sobraram status fora do padrão: ${invalid.map((r) => r.status).join(", ")}`,
    );
    process.exit(1);
  }

  console.log("\n✓ Migração de status concluída.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Falha ao migrar status:", err);
  process.exit(1);
});
