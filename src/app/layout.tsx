import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Help Desk — Tihee",
  description: "Central de suporte por e-mail",
  // Sem `icons` aqui de propósito: o arquivo `src/app/icon.svg` é convenção do
  // Next, que gera o <link> com um hash do conteúdo na URL. É isso que faz o
  // navegador buscar o ícone novo — apontar para /favicon.svg fixo deixava o
  // cache do favicon servir a versão antiga indefinidamente.
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
