import { NextResponse } from "next/server";
import { runRetention } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Limpeza diária. Protegida pelo mesmo CRON_SECRET da ingestão.
 *
 * Separada da rota de ingestão de propósito: a ingestão roda a cada 2 minutos
 * e não pode carregar o custo da limpeza, e uma falha aqui não pode impedir
 * e-mail de entrar.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
  }

  try {
    const result = await runRetention();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
