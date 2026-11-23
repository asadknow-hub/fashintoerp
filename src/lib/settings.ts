import "server-only";
import { cache } from "react";
import { db } from "@/db";
import { settings } from "@/db/schema";

export const getSettings = cache(async () => {
  const [row] = await db.select().from(settings).limit(1);
  return row ?? null;
});

// Currency and time zone used to show money and dates.
export async function getPrefs() {
  const row = await getSettings();
  return { currency: row?.currency ?? "USD", timezone: row?.timezone ?? "UTC" };
}
