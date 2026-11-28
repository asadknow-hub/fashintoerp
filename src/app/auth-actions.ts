"use server";

import { randomBytes } from "node:crypto";
import { and, count, eq, gt, or, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { loginAttempts, sessions, settings, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { isTimeZone, text } from "@/lib/format";

// Wrong tries are counted per email AND per place they come from, so a
// stranger hammering someone's email only locks out the stranger: the real
// person, signing in from somewhere else, is not blocked. The other two
// limits stop one place trying many emails, and many places trying one email.
const MAX_ATTEMPTS = 8;
const MAX_FROM_PLACE = 40;
const MAX_FOR_EMAIL = 100;
const WINDOW_MINUTES = 15;
const TOO_MANY = { error: "Too many tries. Please wait 15 minutes and try again." };

const looksLikeEmail = (email: string) => email.length <= 200 && /^\S+@\S+\.\S+$/.test(email);

// Where the request comes from, as the hosting platform reports it.
async function place() {
  const list = await headers();
  const ip = (list.get("x-forwarded-for")?.split(",")[0] ?? list.get("x-real-ip") ?? "").trim();
  return ip.slice(0, 64) || "unknown";
}

async function tooManyTries(email: string, ip: string) {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
  const [tries] = await db
    .select({
      here: sql<number>`count(*) filter (where ${loginAttempts.email} = ${email} and ${loginAttempts.ip} = ${ip})::int`,
      fromPlace: sql<number>`count(*) filter (where ${loginAttempts.ip} = ${ip})::int`,
      forEmail: sql<number>`count(*) filter (where ${loginAttempts.email} = ${email})::int`,
    })
    .from(loginAttempts)
    .where(
      and(
        gt(loginAttempts.createdAt, since),
        or(eq(loginAttempts.email, email), eq(loginAttempts.ip, ip)),
      ),
    );
  return (
    tries.here >= MAX_ATTEMPTS ||
    tries.fromPlace >= MAX_FROM_PLACE ||
    tries.forEmail >= MAX_FOR_EMAIL
  );
}

async function noteWrongTry(email: string, ip: string) {
  await db.insert(loginAttempts).values({ email, ip });
  // Old tries are of no use: keep the list short.
  await db.delete(loginAttempts).where(sql`${loginAttempts.createdAt} < now() - interval '1 day'`);
}

// Checking a password takes a moment. The same moment is spent when the
// email is unknown, so the wait doesn't give away which emails exist.
let decoy: Promise<string> | null = null;
const decoyHash = () => (decoy ??= hashPassword(randomBytes(16).toString("hex")));

export async function login(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  if (!looksLikeEmail(email)) return { error: "Wrong email or password." };
  const ip = await place();
  if (await tooManyTries(email, ip)) return TOO_MANY;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const known = !!user && user.active;
  const matches = await verifyPassword(password, known ? user.passwordHash : await decoyHash());
  if (!known || !matches) {
    await noteWrongTry(email, ip);
    return { error: "Wrong email or password." };
  }

  await createSession(user.id);
  await audit(user, {
    area: "account",
    action: "account.signed_in",
    subject: user.name,
    summary: "Signed in",
  });
  redirect("/");
}

// Ends the session. The screen then loads the sign-in page from scratch, so
// nothing the person had open stays behind for whoever signs in next.
export async function logout() {
  await destroySession();
}

// First-time setup: creates the business and the owner account.
// Only works while there are no users yet.
export async function setup(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const businessName = text(form, "businessName");
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

  // Already set up: nothing to do here (checked again, under a lock, below).
  const [{ already }] = await db.select({ already: count() }).from(users);
  if (already > 0) redirect("/login");

  const passwordHash = await hashPassword(password);
  const userId = await db.transaction(async (tx) => {
    // Lock so two people can't both become the first owner.
    await tx.execute(sql`lock table users in exclusive mode`);
    const [{ existing }] = await tx.select({ existing: count() }).from(users);
    if (existing > 0) return null;
    await tx.insert(settings).values({ id: 1, businessName, timezone });
    const [user] = await tx
      .insert(users)
      // Whoever sets the system up is its System Admin.
      .values({ name, email, passwordHash, role: "admin" })
      .returning({ id: users.id });
    return user.id;
  });

  if (!userId) redirect("/login");
  await createSession(userId);
  redirect("/");
}

const cleanCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Getting back in after a forgotten password, using the one-time recovery
// code created in Settings. The code works once.
export async function recover(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const email = text(form, "email").toLowerCase();
  const code = cleanCode(text(form, "code"));
  const password = String(form.get("password") ?? "");
  if (!email || !code) return { error: "Enter your email and your recovery code." };
  if (password.length < 8) return { error: "New password must be at least 8 characters." };

  if (!looksLikeEmail(email)) return { error: "That email and recovery code don't match." };
  const ip = await place();
  if (await tooManyTries(email, ip)) return TOO_MANY;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const known = !!user && user.active && !!user.recoveryHash;
  const matches = await verifyPassword(code, known ? user.recoveryHash! : await decoyHash());
  if (!known || !matches) {
    await noteWrongTry(email, ip);
    return { error: "That email and recovery code don't match." };
  }

  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, recoveryHash: null })
      .where(eq(users.id, user.id));
    // Anyone still signed in with the old password is signed out.
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
  });
  await audit(user, {
    area: "account",
    action: "account.recovered",
    subject: user.name,
    summary: "Set a new password with their recovery code",
  });
  await createSession(user.id);
  redirect("/settings");
}
