import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pg?: ReturnType<typeof postgres>;
};

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. See README.md.");
  }
  // prepare:false keeps this working with pooled connections (e.g. Supabase).
  globalForDb.pg ??= postgres(url, { prepare: false, max: 5 });
  return globalForDb.pg;
}

function create() {
  return drizzle(client(), { schema });
}

let instance: ReturnType<typeof create> | undefined;

// Connect on first use so the app can build without a database.
export const db = new Proxy({} as ReturnType<typeof create>, {
  get(_target, prop) {
    instance ??= create();
    const value = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export { schema };
