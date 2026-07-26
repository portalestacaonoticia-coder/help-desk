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

  /* ---- O build atual espera estas tabelas/colunas ---- */

  const names = new Set(tables.map((r) => r.table_name));
  const missingTables = [
    "categories",
    "knowledge_base",
    "ai_settings",
    "ai_actions",
  ].filter((t) => !names.has(t));

  const cols = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'`;
  const have = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
  const missingColumns = [
    "categories.description",
    "categories.active",
    "knowledge_base.keywords",
    "knowledge_base.active",
    "knowledge_base.updated_at",
    "ai_actions.thread_id",
    "ai_actions.status",
    "ai_actions.summary",
  ].filter((c) => names.has(c.split(".")[0]) && !have.has(c));

  if (missingTables.length || missingColumns.length) {
    console.log("\n⚠  MIGRATIONS PENDENTES — o código novo vai quebrar aqui.");
    if (missingTables.length) console.log(`   Tabelas faltando: ${missingTables.join(", ")}`);
    if (missingColumns.length) console.log(`   Colunas faltando: ${missingColumns.join(", ")}`);
    console.log("   Rode: npm run db:generate && npm run db:migrate");
  } else {
    console.log("\n✓  Schema em dia com o código.");
  }

  /* ---- Status dos chamados (aberto | fechado) ---- */

  const status = await sql<{ status: string; n: number }[]>`
    select status, count(*)::int as n from threads group by status order by n desc`;
  console.log("\nStatus dos chamados:");
  for (const s of status) console.log(`  ${s.status.padEnd(20)} ${s.n}`);

  const legacy = status.filter((s) => !["aberto", "fechado"].includes(s.status));
  if (legacy.length > 0) {
    console.log(
      `\n⚠  ${legacy.reduce((t, s) => t + s.n, 0)} chamados ainda com status antigo.`,
    );
    console.log("   Rode: npm run migrate:status");
  }

  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("ERRO:", err.message);
  process.exit(1);
});
