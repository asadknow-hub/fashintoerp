import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { errorLog } from "@/db/schema";

// One line per server error. The same error repeating within a minute (a
// page retrying by itself) is written once, and lines older than 30 days go.
export async function logError(entry: { path: string; message: string; digest: string | null }) {
  const path = entry.path.slice(0, 300);
  const message = entry.message.slice(0, 1000);
  const [recent] = await db
    .select({ id: errorLog.id })
    .from(errorLog)
    .where(
      sql`${errorLog.path} = ${path} and ${errorLog.message} = ${message} and ${errorLog.at} > now() - interval '1 minute'`,
    )
    .limit(1);
  if (recent) return;
  await db.insert(errorLog).values({ path, message, digest: entry.digest?.slice(0, 100) ?? null });
  await db.delete(errorLog).where(sql`${errorLog.at} < now() - interval '30 days'`);
}
