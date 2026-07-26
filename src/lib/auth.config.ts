import type { NextAuthConfig } from "next-auth";

/**
 * Config compartilhada e "edge-safe" (sem acesso ao banco).
 * Usada pelo middleware para proteger rotas. A lógica de login com banco
 * fica em auth.ts (runtime Node).
 */
export const authConfig = {
  // Fica aqui (e não só em auth.ts) para que o middleware consiga decodificar o
  // JWT: sem o mesmo secret, toda rota protegida cairia em redirect para /login.
  // Auth.js v5 procura AUTH_SECRET; aceitamos NEXTAUTH_SECRET para não depender
  // do nome usado no painel do Vercel.
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
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
        pathname.startsWith("/api/cron") ||
        // Diagnóstico do banco — protegido pelo CRON_SECRET, não por sessão.
        pathname.startsWith("/api/diag");

      if (isPublic) return true;
      return isLoggedIn;
    },
  },
} satisfies NextAuthConfig;
