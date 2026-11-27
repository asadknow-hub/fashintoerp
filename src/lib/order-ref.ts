import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

// The number for the next FO: one more than the highest so far, keeping any
// zeros in front (after FO002 comes 003). Numbers that someone else has in
// their Create Order screen right now count as taken, so two people starting
// an order at the same time are not handed the same one.
export async function nextRefNumber(userId: string) {
  const rows = await db.execute<{ digits: string }>(sql`
    select digits from (
      select substring(tracking_number from 3) as digits
      from orders
      where tracking_number ~ '^FO[0-9]{1,12}$'
      union all
      select substring(ref from 3)
      from shipper_ref_claims
      where ref ~ '^FO[0-9]{1,12}$'
        and user_id <> ${userId}
        and seen_at > now() - interval '40 seconds'
    ) taken
    order by digits::numeric desc, length(digits) desc
    limit 1`);
  const last = rows[0]?.digits ?? "";
  return last ? String(BigInt(last) + BigInt(1)).padStart(last.length, "0") : "001";
}
