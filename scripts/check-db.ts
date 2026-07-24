import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

/**
 * Diagnóstico rápido do banco apontado por DATABASE_URL.
 * Útil para conferir se o Neon (produção) está migrado e com admin criado:
 *
 *   DATABASE_URL="postgres://..." npm run check:db
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");

  const host = url.split("@")[1]?.split("/")[0] ?? "?";
  console.log(`Conectando em: ${host}`);

  const sql = postgres(url, {
    max: 1,
    ssl: url.includes("sslmode=require") ? "require" : false,
  });

  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name <> '__drizzle_migrations'
    order by table_name`;
  console.log(`\nTabelas (${tables.length}):`);
  console.log("  " + tables.map((r) => r.table_name).join(", "));

  const users = await sql<{ email: string; role: string }[]>`
    select email, role from users order by id`;
  console.log(`\nUsuários (${users.length}):`);
  for (const u of users) console.log(`  ${u.email} [${u.role}]`);

  const [counts] = await sql<{ mb: number; th: number; ms: number; mc: number }[]>`
    select
      (select count(*) from mailboxes)::int as mb,
      (select count(*) from threads)::int   as th,
      (select count(*) from messages)::int  as ms,
      (select count(*) from macros)::int    as mc`;
  console.log(
    `\nCaixas: ${counts.mb} · Threads: ${counts.th} · Mensagens: ${counts.ms} · Macros: ${counts.mc}`,
  );

  if (counts.mb === 0) {
    console.log("\n⚠  Nenhuma caixa cadastrada — a ingestão não terá o que buscar.");
  }

  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("ERRO:", err.message);
  process.exit(1);
});
