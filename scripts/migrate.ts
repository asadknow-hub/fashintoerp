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
  const client = postgres(databaseUrl(), {
    max: 1,
    prepare: false,
    // One query at a time: Supabase's pooler stops answering otherwise.
    max_pipeline: 1,
    connect_timeout: 30,
  });

  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
  clearTimeout(guard);
  console.log("Database is up to date.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
