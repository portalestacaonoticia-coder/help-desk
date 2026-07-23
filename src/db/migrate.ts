import { config } from "dotenv";
config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida");

  const client = postgres(url, {
    max: 1,
    ssl: url.includes("sslmode=require") ? "require" : false,
  });
  const db = drizzle(client);

  console.log("Aplicando migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations aplicadas com sucesso.");

  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Falha ao migrar:", err);
  process.exit(1);
});
