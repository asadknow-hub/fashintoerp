import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { databaseUrl } from "./url";

const globalForDb = globalThis as unknown as {
  pg?: ReturnType<typeof postgres>;
};

function client() {
  // prepare:false keeps this working with pooled connections (e.g. Supabase).
  // Connections that sit unused are handed back after a few seconds, so
  // copies of the app that have gone quiet don't hold on to them.
  globalForDb.pg ??= postgres(databaseUrl(), {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
  });
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
