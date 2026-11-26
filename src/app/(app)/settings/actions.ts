"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { settings, users } from "@/db/schema";
import { hashPassword, requireOwner, requireUser, verifyPassword } from "@/lib/auth";
import { CURRENCIES } from "@/lib/currencies";
import { isTimeZone, text } from "@/lib/format";

export async function updateBusiness(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireOwner();
  const businessName = text(form, "businessName");
  const currency = text(form, "currency");
  if (!businessName) return { error: "Enter your business name." };
  const timezone = text(form, "timezone");
  if (!CURRENCIES.some((c) => c.code === currency)) return { error: "Pick a currency." };
  if (!timezone || !isTimeZone(timezone)) return { error: "Pick a time zone." };
  await db.update(settings).set({ businessName, currency, timezone }).where(eq(settings.id, 1));
  refresh();
  return { ok: "Saved." };
}

export async function changePassword(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 8) return { error: "New password must be at least 8 characters." };

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id));
  if (!row || !(await verifyPassword(current, row.passwordHash))) {
    return { error: "Your current password is wrong." };
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, user.id));
  return { ok: "Password changed." };
}
