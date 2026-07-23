import { config } from "dotenv";
config({ path: ".env.local" });

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { users, macros } from "../src/db/schema";

/**
 * Cria o usuário admin inicial e algumas macros de exemplo.
 * Credenciais do admin vêm de env (ou usa defaults de dev).
 *
 *   ADMIN_EMAIL=voce@tihee.com.br ADMIN_PASSWORD=... npm run seed
 */
async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "admin@tihee.com.br")
    .trim()
    .toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "changeme123";
  const name = process.env.ADMIN_NAME ?? "Admin";

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    console.log(`Usuário ${email} já existe — pulando criação.`);
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    await db.insert(users).values({
      email,
      name,
      passwordHash,
      role: "admin",
    });
    console.log(`✓ Admin criado: ${email}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.log(`  Senha padrão de dev: "${password}" — TROQUE em produção.`);
    }
  }

  // Macros de exemplo (idempotente por título).
  const sampleMacros = [
    {
      title: "Confirmação de recebimento",
      shortcut: "/recebi",
      body: "Olá! Recebemos sua mensagem e já estamos analisando. Retornamos em breve.",
    },
    {
      title: "Pedido de mais informações",
      shortcut: "/info",
      body: "Para prosseguir, poderia nos enviar mais detalhes (número do pedido, prints, etc.)?",
    },
  ];

  for (const m of sampleMacros) {
    const has = await db
      .select({ id: macros.id })
      .from(macros)
      .where(eq(macros.title, m.title))
      .limit(1);
    if (has.length === 0) {
      await db.insert(macros).values(m);
      console.log(`✓ Macro criada: ${m.title}`);
    }
  }

  console.log("Seed concluído.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Falha no seed:", err);
  process.exit(1);
});
