import { NextResponse } from "next/server";
import { ingestAllMailboxes } from "@/lib/imap";
import { processPendingMessages } from "@/lib/ai";

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

    // Gera os rascunhos da IA para o que acabou de entrar. Uma falha aqui não
    // pode derrubar a ingestão — os e-mails já estão salvos.
    let ai: Awaited<ReturnType<typeof processPendingMessages>> | { error: string };
    try {
      ai = await processPendingMessages();
    } catch (err) {
      ai = { error: err instanceof Error ? err.message : String(err) };
    }

    return NextResponse.json({
      ok: errors.length === 0,
      durationMs: Date.now() - started,
      totalFetched,
      mailboxes: results,
      ai,
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
