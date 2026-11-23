"use server";

import { and, eq, ne } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { sessions, settings, users } from "@/db/schema";
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

export async function addTeamMember(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireOwner();
  const name = text(form, "name");
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!name) return { error: "Enter their name." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (existing) return { error: "Someone already uses that email." };

  await db
    .insert(users)
    .values({ name, email, passwordHash: await hashPassword(password), role: "staff" });
  refresh();
  return { ok: `Added. Share the email and password with ${name}.` };
}

// Turns a staff member's access off or on. Turning off also signs them out.
export async function setMemberActive(userId: string, active: boolean) {
  const owner = await requireOwner();
  if (userId === owner.id) return;
  await db
    .update(users)
    .set({ active })
    .where(and(eq(users.id, userId), ne(users.role, "owner")));
  if (!active) await db.delete(sessions).where(eq(sessions.userId, userId));
  refresh();
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
