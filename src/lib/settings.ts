import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { CURRENCY } from "./format";

export const getSettings = cache(async () => {
  const [row] = await db.select().from(settings).limit(1);
  return row ?? null;
});

// The currency (always the same) and the time zone used to show dates.
export async function getPrefs() {
  const row = await getSettings();
  return { currency: CURRENCY, timezone: row?.timezone ?? "UTC" };
}
