// Creates / updates the database tables. Run with: npm run db:migrate
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseSsl, databaseUrl } from "../src/db/url";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // If the database does not answer at all, stop here with a clear message
  // instead of leaving the update hanging.
  const guard = setTimeout(() => {
    console.error("The database update did not finish within 5 minutes.");
    process.exit(1);
  }, 300_000);
  const ssl = databaseSsl();
  const client = postgres(databaseUrl(), {
    ...(ssl && { ssl }),
    max: 1,
    prepare: false,
    // One query at a time: Supabase's pooler stops answering otherwise.
    max_pipeline: 1,
    connect_timeout: 30,
    onnotice: () => {},
  });

  // Only one update at a time. Two deploys started close together would
  // otherwise both read "what was applied last" and both apply the same
  // step. The marker is a row that is put in before and taken out after; one
  // left behind by an update that crashed stops counting after 10 minutes.
  await client`create schema if not exists drizzle`;
  await client`create table if not exists drizzle.update_running (one boolean primary key default true, since timestamptz not null default now())`;
  let mine = false;
  for (let waited = 0; waited < 240 && !mine; waited += 5) {
    await client`delete from drizzle.update_running where since < now() - interval '10 minutes'`;
    const taken = await client`insert into drizzle.update_running default values on conflict do nothing returning one`;
    mine = taken.length > 0;
    if (!mine) {
      if (waited === 0) console.log("Another update is running. Waiting for it to finish…");
      await pause(5000);
    }
  }
  if (!mine) throw new Error("Another database update has been running for 4 minutes. Try again later.");

  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  } finally {
    await client`delete from drizzle.update_running`;
  }
  await client.end();
  clearTimeout(guard);
  console.log("Database is up to date.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
