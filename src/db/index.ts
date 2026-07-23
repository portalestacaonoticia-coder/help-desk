import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Conexão preguiçosa: só lê DATABASE_URL e abre o client no primeiro uso.
 * Isso evita erro de ordem de import em scripts que carregam dotenv no corpo
 * do módulo (o import é avaliado antes do config()).
 */
const globalForDb = globalThis as unknown as {
  __pg?: ReturnType<typeof postgres>;
  __db?: PostgresJsDatabase<typeof schema>;
};

function createDb(): PostgresJsDatabase<typeof schema> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL não definida");
  }
  const isProd = process.env.NODE_ENV === "production";

  const client =
    globalForDb.__pg ??
    postgres(connectionString, {
      max: isProd ? 1 : 5,
      prepare: false,
      ssl: connectionString.includes("sslmode=require") ? "require" : false,
    });
  if (!isProd) globalForDb.__pg = client;

  return drizzle(client, { schema });
}

// Proxy que instancia o db real na primeira propriedade acessada.
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = (globalForDb.__db ??= createDb());
    const value = Reflect.get(real, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
