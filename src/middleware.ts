import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Middleware usa apenas a config edge-safe (sem banco).
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Protege tudo, exceto assets estáticos e imagens. O .svg precisa ficar de
  // fora: o logo aparece na tela de login, antes de haver sessão.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png|.*\\.ico).*)",
  ],
};
