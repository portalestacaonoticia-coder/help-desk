import { config } from "dotenv";
config({ path: ".env.local" });

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { users } from "../src/db/schema";

/**
 * Cria ou atualiza um usuário do dashboard. Também renomeia o e-mail de login.
 *
 * Variáveis:
 *   USER_EMAIL     (obrigatório) e-mail final de login
 *   OLD_EMAIL      (opcional) se informado, renomeia esse usuário para USER_EMAIL
 *   USER_PASSWORD  (opcional) define/reseta a senha; se omitido em usuário
 *                  existente, mantém a senha atual
 *   USER_NAME      (opcional) nome exibido
 *   USER_ROLE      (opcional) admin | agent  (padrão: agent na criação)
 *
 * Exemplos:
 *   USER_EMAIL=agente@tihee.com.br USER_PASSWORD=... USER_NAME="Agente" npm run user
 *   OLD_EMAIL=antigo@x.com USER_EMAIL=novo@x.com npm run user
 */
async function main() {
  const email = (process.env.USER_EMAIL ?? "").trim().toLowerCase();
  if (!email) throw new Error("USER_EMAIL é obrigatório");

  const oldEmail = (process.env.OLD_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.USER_PASSWORD;
  const name = process.env.USER_NAME;
  const role = process.env.USER_ROLE;

  // Localiza o alvo: pelo e-mail antigo (renomeando) ou pelo próprio e-mail.
  const lookup = oldEmail || email;
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, lookup))
    .limit(1);

  if (existing) {
    const patch: Partial<typeof users.$inferInsert> = {};
    if (email !== existing.email) patch.email = email;
    if (name) patch.name = name;
    if (role) patch.role = role;
    if (password) patch.passwordHash = await bcrypt.hash(password, 12);

    if (Object.keys(patch).length === 0) {
      console.log(`Nada a alterar em ${existing.email}.`);
    } else {
      await db.update(users).set(patch).where(eq(users.id, existing.id));
      console.log(
        `✓ Usuário atualizado: ${existing.email}` +
          (patch.email ? ` → ${patch.email}` : "") +
          (patch.passwordHash ? " (senha redefinida)" : ""),
      );
    }
  } else {
    if (!password) {
      throw new Error("USER_PASSWORD é obrigatório para criar um usuário novo");
    }
    await db.insert(users).values({
      email,
      name: name ?? email.split("@")[0],
      passwordHash: await bcrypt.hash(password, 12),
      role: role ?? "agent",
    });
    console.log(`✓ Usuário criado: ${email} [${role ?? "agent"}]`);
  }

  const all = await db
    .select({ email: users.email, role: users.role, active: users.active })
    .from(users)
    .orderBy(users.id);
  console.log("\nUsuários no banco:");
  for (const u of all) {
    console.log(`  ${u.email} [${u.role}]${u.active ? "" : " (inativo)"}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("ERRO:", err.message);
  process.exit(1);
});
