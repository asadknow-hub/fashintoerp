"use server";

import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { hashPassword, requireOwner } from "@/lib/auth";
import { isUuid, text } from "@/lib/format";

function readDetails(form: FormData) {
  const name = text(form, "name");
  const email = text(form, "email").toLowerCase();
  const role = text(form, "role") === "owner" ? "owner" : "staff";
  const password = String(form.get("password") ?? "");
  if (!name) return { error: "Enter their name." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email." };
  return { name, email, role, password } as const;
}

async function emailTaken(email: string, exceptId?: string) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      exceptId
        ? and(eq(users.email, email), ne(users.id, exceptId))
        : eq(users.email, email),
    )
    .limit(1);
  return !!row;
}

export async function createStaff(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireOwner();
  const details = readDetails(form);
  if ("error" in details) return details;
  if (details.password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (await emailTaken(details.email)) {
    return { error: "Someone already uses that email." };
  }

  await db.insert(users).values({
    name: details.name,
    email: details.email,
    role: details.role,
    passwordHash: await hashPassword(details.password),
  });
  redirect("/staff");
}

export async function updateStaff(
  staffId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const me = await requireOwner();
  if (!isUuid(staffId)) return { error: "Staff member not found." };
  const details = readDetails(form);
  if ("error" in details) return details;
  if (details.password && details.password.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  if (await emailTaken(details.email, staffId)) {
    return { error: "Someone already uses that email." };
  }

  const self = staffId === me.id;
  const active = form.get("active") === "on";
  // You can't lock yourself out: your own role and access stay as they are.
  if (self && (details.role !== "owner" || !active)) {
    return { error: "You can't remove your own access or System Admin role." };
  }

  const [updated] = await db
    .update(users)
    .set({
      name: details.name,
      email: details.email,
      role: details.role,
      active,
      ...(details.password && {
        passwordHash: await hashPassword(details.password),
      }),
    })
    .where(eq(users.id, staffId))
    .returning({ id: users.id });
  if (!updated) return { error: "Staff member not found." };

  // A new password or removed access signs them out everywhere.
  if (!self && (details.password || !active)) {
    await db.delete(sessions).where(eq(sessions.userId, staffId));
  }
  redirect("/staff");
}

export async function deleteStaff(staffId: string): Promise<ActionState> {
  const me = await requireOwner();
  if (!isUuid(staffId)) return { error: "Staff member not found." };
  if (staffId === me.id) return { error: "You can't delete your own account." };
  await db.delete(users).where(eq(users.id, staffId));
  redirect("/staff");
}
