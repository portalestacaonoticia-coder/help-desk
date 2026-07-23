import type { NextAuthConfig } from "next-auth";

/**
 * Config compartilhada e "edge-safe" (sem acesso ao banco).
 * Usada pelo middleware para proteger rotas. A lógica de login com banco
 * fica em auth.ts (runtime Node).
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    // Chamado pelo middleware: decide se a requisição pode seguir.
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;

      const isPublic =
        pathname.startsWith("/login") ||
        pathname.startsWith("/api/auth") ||
        pathname.startsWith("/api/cron");

      if (isPublic) return true;
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;
