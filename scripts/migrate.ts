// Creates / updates the database tables. Run with: npm run db:migrate
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { databaseUrl } from "../src/db/url";

async function main() {
  // If the database does not answer at all, stop here with a clear message
  // instead of leaving the update hanging.
  const guard = setTimeout(() => {
    console.error("The database did not answer within 2 minutes.");
    process.exit(1);
  }, 120_000);
  const client = postgres(databaseUrl(), { max: 1, prepare: false, connect_timeout: 30 });

  // Connections left open by earlier copies of the site can take up every
  // place the database has. Close the ones that have sat unused for a while
  // (and any that were left in the middle of something).
  try {
    const [closed] = await client`
      select count(pg_terminate_backend(pid))::int as total
      from pg_stat_activity
      where usename = current_user
        and pid <> pg_backend_pid()
        and state like 'idle%'
        and state_change < now() - interval '3 minutes'`;
    console.log(`Closed ${closed.total} unused database connections.`);
  } catch (err) {
    console.warn("Could not close unused database connections:", String(err));
  }
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
  clearTimeout(guard);
  console.log("Database is up to date.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
