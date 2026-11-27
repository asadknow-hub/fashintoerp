"use server";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { deliveryCompanies, orders, settings, users } from "@/db/schema";
import { hashPassword, requireOwner, requireUser, verifyPassword } from "@/lib/auth";
import { amount, isTimeZone, isUuid, text } from "@/lib/format";

export async function updateBusiness(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireOwner();
  const businessName = text(form, "businessName");
  if (!businessName) return { error: "Enter your business name." };
  const timezone = text(form, "timezone");
  if (!timezone || !isTimeZone(timezone)) return { error: "Pick a time zone." };
  await db.update(settings).set({ businessName, timezone }).where(eq(settings.id, 1));
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

// Letters and digits that are hard to mix up when written down.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Makes a fresh one-time code for getting back in after a forgotten password.
// Only its scrambled form is stored, so it is shown this once and never again.
export async function createRecoveryCode(): Promise<ActionState> {
  const user = await requireUser();
  const bytes = randomBytes(20);
  const letters = [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]);
  const code = [0, 5, 10, 15].map((start) => letters.slice(start, start + 5).join("")).join("-");
  await db
    .update(users)
    .set({ recoveryHash: await hashPassword(code.replaceAll("-", "")) })
    .where(eq(users.id, user.id));
  refresh();
  return {
    ok: `Your recovery code is ${code} — write it down and keep it somewhere safe. It will not be shown again.`,
  };
}

/* ---------- Delivery companies ---------- */

function readCompany(form: FormData) {
  const name = text(form, "name").slice(0, 80);
  if (!name) return { error: "Enter the company's name." };
  const rate = text(form, "rate") === "" ? "0" : amount(form, "rate");
  if (rate === null) return { error: "The delivery charge must be a number." };
  return { name, rate };
}

export async function addCompany(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const values = readCompany(form);
  if ("error" in values) return { error: values.error };
  await db.insert(deliveryCompanies).values(values);
  refresh();
  return { ok: "Added." };
}

export async function updateCompany(
  companyId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireOwner();
  if (!isUuid(companyId)) return { error: "That company no longer exists." };
  const values = readCompany(form);
  if ("error" in values) return { error: values.error };
  await db.update(deliveryCompanies).set(values).where(eq(deliveryCompanies.id, companyId));
  refresh();
  return { ok: "Saved." };
}

// A company that orders already went out with is kept for those orders and
// only taken off the list to choose from; an unused one is deleted.
export async function removeCompany(companyId: string): Promise<ActionState> {
  await requireOwner();
  if (!isUuid(companyId)) return { error: "That company no longer exists." };
  const [used] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.deliveryCompanyId, companyId))
    .limit(1);
  if (used) {
    await db
      .update(deliveryCompanies)
      .set({ active: false })
      .where(eq(deliveryCompanies.id, companyId));
  } else {
    await db.delete(deliveryCompanies).where(eq(deliveryCompanies.id, companyId));
  }
  refresh();
  return null;
}
