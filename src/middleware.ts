import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Middleware usa apenas a config edge-safe (sem banco).
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Protege tudo, exceto assets estáticos e imagens.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
