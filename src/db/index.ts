import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { databaseSsl, databaseUrl } from "./url";

const globalForDb = globalThis as unknown as {
  pg?: ReturnType<typeof postgres>;
};

function client() {
  // prepare:false keeps this working with pooled connections (e.g. Supabase).
  //
  // max_pipeline:1 sends one query at a time on each connection. Supabase's
  // pooler on port 6543 stops answering when several are sent together (see
  // "Connection poolers" in the postgres package's README), which left every
  // page loading forever.
  //
  // The timeouts make a database that has gone quiet show up as an error
  // within seconds instead of a page that never finishes, and unused
  // connections are handed back so sleeping copies of the app don't keep them.
  // A few connections per copy of the app are plenty: a page's queries
  // queue for a moment rather than one page taking every connection there is.
  const ssl = databaseSsl();
  globalForDb.pg ??= postgres(databaseUrl(), {
    ...(ssl && { ssl }),
    prepare: false,
    max: 5,
    max_pipeline: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    queue_timeout: 20,
    query_timeout: 30,
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
