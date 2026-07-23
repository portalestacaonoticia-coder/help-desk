import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Help Desk — Tihee",
  description: "Central de suporte por e-mail",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
