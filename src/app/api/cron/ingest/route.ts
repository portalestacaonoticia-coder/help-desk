import { NextResponse } from "next/server";
import { ingestAllMailboxes } from "@/lib/imap";

// Ingestão IMAP conecta e usa libs Node — força runtime Node e sem cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Endpoint chamado pelo Vercel Cron a cada 2 min.
 * Protegido por CRON_SECRET (o Vercel envia "Authorization: Bearer <CRON_SECRET>").
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
  }

  const started = Date.now();
  try {
    const results = await ingestAllMailboxes();
    const totalFetched = results.reduce((s, r) => s + r.fetched, 0);
    const errors = results.filter((r) => r.status === "error");

    return NextResponse.json({
      ok: errors.length === 0,
      durationMs: Date.now() - started,
      totalFetched,
      mailboxes: results,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
