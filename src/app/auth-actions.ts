"use server";

import { and, count, eq, gt, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { loginAttempts, settings, users } from "@/db/schema";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { CURRENCIES } from "@/lib/currencies";
import { isTimeZone, text } from "@/lib/format";

const MAX_ATTEMPTS = 8;
const WINDOW_MINUTES = 15;

export async function login(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const [{ attempts }] = await db
    .select({ attempts: count() })
    .from(loginAttempts)
    .where(
      and(eq(loginAttempts.email, email), gt(loginAttempts.createdAt, since)),
    );
  if (attempts >= MAX_ATTEMPTS) {
    return { error: "Too many tries. Please wait 15 minutes and try again." };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const valid =
    !!user && user.active && (await verifyPassword(password, user.passwordHash));
  if (!valid) {
    await db.insert(loginAttempts).values({ email });
    return { error: "Wrong email or password." };
  }

  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

// First-time setup: creates the business and the owner account.
// Only works while there are no users yet.
export async function setup(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const businessName = text(form, "businessName");
  const currency = text(form, "currency");
  const name = text(form, "name");
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const zone = text(form, "timezone");
  const timezone = isTimeZone(zone) ? zone : "UTC";

  if (!businessName || !name) return { error: "Please fill in every field." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email." };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (!CURRENCIES.some((c) => c.code === currency)) {
    return { error: "Pick a currency." };
  }

  const passwordHash = await hashPassword(password);
  const userId = await db.transaction(async (tx) => {
    // Lock so two people can't both become the first owner.
    await tx.execute(sql`lock table users in exclusive mode`);
    const [{ existing }] = await tx.select({ existing: count() }).from(users);
    if (existing > 0) return null;
    await tx.insert(settings).values({ id: 1, businessName, currency, timezone });
    const [user] = await tx
      .insert(users)
      .values({ name, email, passwordHash, role: "owner" })
      .returning({ id: users.id });
    return user.id;
  });

  if (!userId) redirect("/login");
  await createSession(userId);
  redirect("/");
}
