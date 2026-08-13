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
 * Não devolve dado de cliente — nomes de tabela/coluna, contagens e mensagens
 * de erro operacionais (SMTP/DeepSeek), truncadas.
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
  "auto_replies",
];

// Colunas adicionadas depois da migration inicial — se faltarem, o build novo
// está rodando contra um banco antigo.
const EXPECTED_COLUMNS: Record<string, string[]> = {
  categories: ["description", "active"],
  knowledge_base: ["keywords", "active", "updated_at"],
  ai_actions: ["thread_id", "summary", "source_article_ids", "model", "status"],
  macros: ["mailbox_id"],
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

    /* ---- Envio automático: onde a resposta parou --------------------- */

    // Travas da configuração. Com qualquer uma delas desligada nada sai.
    let aiFlags: Record<string, boolean | number> | null = null;
    if (present.has("ai_settings")) {
      const [row] = await db.execute<{
        enabled: boolean;
        auto_send_enabled: boolean;
        auto_send_prompt_len: number;
      }>(
        sql`select enabled, auto_send_enabled,
                   length(coalesce(auto_send_prompt, '')) as auto_send_prompt_len
            from ai_settings where id = 1`,
      );
      aiFlags = row ?? null;
    }

    // Textos cadastrados por caixa e idioma. Vazio com a tabela existindo
    // significa que a tela salvou em outro banco.
    let autoRepliesByMailbox: Array<{
      mailbox_id: number;
      language: string;
      active: boolean;
    }> = [];
    if (present.has("auto_replies")) {
      autoRepliesByMailbox = [
        ...(await db.execute<{
          mailbox_id: number;
          language: string;
          active: boolean;
        }>(
          sql`select mailbox_id, language, active from auto_replies
              order by mailbox_id, language`,
        )),
      ];
    }

    // O que a IA fez nas últimas 24h. "sugerido" em massa com o envio
    // automático ligado = o modelo não está liberando (posso_enviar false).
    let aiLast24h: Array<{ action_taken: string; n: number }> = [];
    let lastAiError: string | null = null;
    if (present.has("ai_actions")) {
      aiLast24h = [
        ...(await db.execute<{ action_taken: string; n: number }>(
          sql`select coalesce(action_taken, '(null)') as action_taken,
                     count(*)::int as n
              from ai_actions
              where created_at > now() - interval '24 hours'
              group by 1 order by n desc`,
        )),
      ];
      const [err] = await db.execute<{ error_message: string }>(
        sql`select left(error_message, 200) as error_message from ai_actions
            where error_message is not null
            order by created_at desc limit 1`,
      );
      lastAiError = err?.error_message ?? null;
    }

    const migrationsApplied = missingTables.length === 0 && missingColumns.length === 0;

    return NextResponse.json({
      db: "ok",
      migrationsApplied,
      missingTables,
      missingColumns,
      statusCounts,
      statusMigrationPending: legacy.length > 0,
      aiFlags,
      autoRepliesByMailbox,
      aiLast24h,
      lastAiError,
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
