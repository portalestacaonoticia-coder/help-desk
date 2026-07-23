import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Carrega .env.local para o drizzle-kit (CLI fora do runtime do Next)
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
