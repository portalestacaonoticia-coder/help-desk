import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Diagnóstico do banco em produção. Responde o que está aplicado e o que falta,
 * para não ter que adivinhar a causa de um 500 a partir do digest.
 *
 * Protegido pelo CRON_SECRET:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/diag
 *
 * Não devolve nenhum dado de cliente — só nomes de tabela/coluna e contagens.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_TABLES = [
  "mailboxes",
  "users",
  "threads",
  "messages",
  "macros",
  "ingest_logs",
  "categories",
  "knowledge_base",
  "ai_settings",
  "ai_actions",
];

// Colunas adicionadas depois da migration inicial — se faltarem, o build novo
// está rodando contra um banco antigo.
const EXPECTED_COLUMNS: Record<string, string[]> = {
  categories: ["description", "active"],
  knowledge_base: ["keywords", "active", "updated_at"],
  ai_actions: ["thread_id", "summary", "source_article_ids", "model", "status"],
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
  }

  try {
    const tableRows = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public'`,
    );
    const present = new Set(tableRows.map((r) => r.table_name));
    const missingTables = EXPECTED_TABLES.filter((t) => !present.has(t));

    const columnRows = await db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns
          where table_schema = 'public'`,
    );
    const byTable = new Map<string, Set<string>>();
    for (const r of columnRows) {
      if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Set());
      byTable.get(r.table_name)!.add(r.column_name);
    }

    const missingColumns: string[] = [];
    for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
      if (!present.has(table)) continue;
      const have = byTable.get(table) ?? new Set();
      for (const c of cols) if (!have.has(c)) missingColumns.push(`${table}.${c}`);
    }

    // Distribuição de status: revela se o migrate:status já rodou.
    let statusCounts: Array<{ status: string; n: number }> = [];
    if (present.has("threads")) {
      statusCounts = [
        ...(await db.execute<{ status: string; n: number }>(
          sql`select status, count(*)::int as n from threads
              group by status order by n desc`,
        )),
      ];
    }
    const legacy = statusCounts.filter(
      (s) => !["aberto", "fechado"].includes(s.status),
    );

    const migrationsApplied = missingTables.length === 0 && missingColumns.length === 0;

    return NextResponse.json({
      db: "ok",
      migrationsApplied,
      missingTables,
      missingColumns,
      statusCounts,
      statusMigrationPending: legacy.length > 0,
      env: {
        DEEPSEEK_API_KEY: Boolean(process.env.DEEPSEEK_API_KEY),
        ENCRYPTION_KEY: Boolean(process.env.ENCRYPTION_KEY),
        CRON_SECRET: Boolean(process.env.CRON_SECRET),
        authSecret: Boolean(
          process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
        ),
      },
      hint: migrationsApplied
        ? legacy.length > 0
          ? "Rode `npm run migrate:status` para converter os status antigos."
          : "Banco em dia."
        : "Rode `npm run db:generate && npm run db:migrate` apontando para este banco.",
    });
  } catch (err) {
    return NextResponse.json(
      {
        db: "erro",
        error: err instanceof Error ? err.message : String(err),
        code: (err as { code?: string })?.code ?? null,
      },
      { status: 500 },
    );
  }
}
