"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { transactions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { amount, formatMoney, isUuid, text } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

const NOT_FOR_STAFF = { error: "Only an Owner or the System Admin can do this." };

const todayIn = (timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

// Adds a line to the accounts book, or corrects one: the day, whether money
// went out or came in, how much, what for, and which member of staff it was by.
export async function saveTransaction(
  transactionId: string | null,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (user.role === "staff") return NOT_FOR_STAFF;
  if (transactionId !== null && !isUuid(String(transactionId))) {
    return { error: "That line no longer exists." };
  }
  const { timezone } = await getPrefs();

  const day = text(form, "day");
  const real =
    /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day;
  if (!real) return { error: "Choose the date." };
  if (day > todayIn(timezone)) return { error: "The date can't be in the future." };
  const direction = text(form, "direction") === "in" ? "in" : "out";
  const typed = text(form, "amount");
  const sum = amount(form, "amount");
  if (typed === "" || sum === null || Number(sum) <= 0) {
    return { error: "Enter the amount, more than 0." };
  }
  const purpose = text(form, "purpose").slice(0, 200);
  if (!purpose) return { error: "Say what it was for." };
  const byId = text(form, "by");
  if (!isUuid(byId)) return { error: "Choose who it was by." };
  const [by] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, byId));
  if (!by) return { error: "That person's account no longer exists." };

  const values = { day, direction, amount: sum, purpose, byUserId: by.id, byName: by.name } as const;
  if (transactionId) {
    const [changed] = await db
      .update(transactions)
      .set(values)
      .where(eq(transactions.id, transactionId))
      .returning({ id: transactions.id });
    if (!changed) return { error: "That line no longer exists." };
  } else {
    await db.insert(transactions).values({ ...values, createdBy: user.id });
  }
  await audit(user, {
    area: "money",
    action: transactionId ? "money.changed" : "money.added",
    subject: purpose,
    summary:
      `${transactionId ? "Changed a line in the accounts" : "Added to the accounts"}: ` +
      `${direction === "in" ? "money in" : "money out"} ${formatMoney(sum)} for ${purpose}, by ${by.name}, on ${day}`,
  });
  refresh();
  return { ok: "Saved." };
}

export async function deleteTransaction(transactionId: string): Promise<ActionState> {
  const user = await requireUser();
  if (user.role === "staff") return NOT_FOR_STAFF;
  if (!isUuid(String(transactionId))) return { error: "That line no longer exists." };
  const [gone] = await db
    .delete(transactions)
    .where(and(eq(transactions.id, transactionId)))
    .returning({
      day: transactions.day,
      direction: transactions.direction,
      amount: transactions.amount,
      purpose: transactions.purpose,
      byName: transactions.byName,
    });
  if (gone) {
    await audit(user, {
      area: "money",
      action: "money.deleted",
      subject: gone.purpose,
      summary: `Deleted from the accounts: ${gone.direction === "in" ? "money in" : "money out"} ${formatMoney(gone.amount)} for ${gone.purpose}, by ${gone.byName}, on ${gone.day}`,
    });
  }
  refresh();
  return { ok: "Deleted." };
}
