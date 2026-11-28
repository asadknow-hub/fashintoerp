import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getUser } from "@/lib/auth";

// Someone whose screen checked in within this long is "online". Screens
// check in about every 45 seconds; a tab in the background is slowed down by
// the browser, so the window leaves room for that.
const ONLINE_SECONDS = 150;

// Every open screen calls this now and then to say "still here". An Owner or
// the System Admin gets back who is online, and when everyone else was last
// seen; staff only check in.
export async function POST() {
  const user = await getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  await db.update(users).set({ lastSeenAt: sql`now()` }).where(eq(users.id, user.id));
  if (user.role === "staff") return Response.json({ people: [] }, noStore);

  const people = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      // How long ago, in seconds, worked out by the database so the answer
      // does not depend on the clock of the person's computer.
      ago: sql<number | null>`extract(epoch from (now() - ${users.lastSeenAt}))::int`,
    })
    .from(users)
    .where(and(eq(users.active, true)))
    .orderBy(asc(users.name));
  return Response.json(
    {
      people: people.map((person) => ({
        ...person,
        me: person.id === user.id,
        online: person.id === user.id || (person.ago !== null && person.ago <= ONLINE_SECONDS),
      })),
    },
    noStore,
  );
}

const noStore = { headers: { "Cache-Control": "no-store" } };
