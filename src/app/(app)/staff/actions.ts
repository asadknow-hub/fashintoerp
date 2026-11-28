"use server";

import { audit } from "@/lib/audit";
import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { hashPassword, requireOwner } from "@/lib/auth";
import { isUuid, text } from "@/lib/format";
import { canManage, givable, type Role, roleLabel } from "@/lib/roles";

// `mine` is the role of whoever is filling the form in: they can only hand
// out the roles below their own (nobody can make a second System Admin).
function readDetails(form: FormData, mine: Role) {
  const name = text(form, "name");
  const email = text(form, "email").toLowerCase();
  const asked = text(form, "role") || "staff";
  const role = givable(mine).find((one) => one === asked);
  const password = String(form.get("password") ?? "");
  if (!name) return { error: "Enter their name." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email." };
  return { name, email, role, password } as const;
}

const notYours = {
  error: "Only the System Admin can change an Owner's account, and nobody can change the System Admin's.",
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
  const me = await requireOwner();
  const details = readDetails(form, me.role);
  if ("error" in details) return details;
  const role = details.role;
  if (!role) return { error: "Only the System Admin can add an Owner." };
  if (details.password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (await emailTaken(details.email)) {
    return { error: "Someone already uses that email." };
  }

  await db.insert(users).values({
    name: details.name,
    email: details.email,
    role,
    passwordHash: await hashPassword(details.password),
  });
  await audit(me, {
    area: "staff",
    action: "staff.created",
    subject: details.name,
    summary: `Added the account ${details.email} as ${roleLabel[role]}`,
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
  const details = readDetails(form, me.role);
  if ("error" in details) return details;
  const [them] = await db.select({ role: users.role }).from(users).where(eq(users.id, staffId));
  if (!them) return { error: "Staff member not found." };
  const self = staffId === me.id;
  // Your own details, or the account of someone below you.
  if (!self && !canManage(me.role, them.role)) return notYours;
  // Your own role stays as it is; for anyone else it must be one you can give.
  const role = self ? me.role : details.role;
  if (!role) return { error: "Only the System Admin can make someone an Owner." };
  // Your own password is changed in Settings, where the current one is asked.
  const password = self ? "" : details.password;
  if (password && password.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  if (await emailTaken(details.email, staffId)) {
    return { error: "Someone already uses that email." };
  }

  const active = form.get("active") === "on";
  // You can't lock yourself out.
  if (self && !active) return { error: "You can't remove your own access." };

  const [updated] = await db
    .update(users)
    .set({
      name: details.name,
      email: details.email,
      role,
      active,
      ...(password && {
        passwordHash: await hashPassword(password),
      }),
    })
    // Still the role it was checked against a moment ago.
    .where(and(eq(users.id, staffId), eq(users.role, them.role)))
    .returning({ id: users.id });
  if (!updated) return { error: "This account was changed a moment ago. Open it again." };

  // A new password or removed access signs them out everywhere.
  if (!self && (password || !active)) {
    await db.delete(sessions).where(eq(sessions.userId, staffId));
  }
  await audit(me, {
    area: "staff",
    action: "staff.edited",
    subject: details.name,
    summary:
      `Edited the account ${details.email}: ${roleLabel[role]}, access ${active ? "on" : "off"}` +
      (password ? ", new password set" : ""),
  });
  redirect("/staff");
}

export async function deleteStaff(staffId: string): Promise<ActionState> {
  const me = await requireOwner();
  if (!isUuid(staffId)) return { error: "Staff member not found." };
  if (staffId === me.id) return { error: "You can't delete your own account." };
  const [them] = await db.select({ role: users.role }).from(users).where(eq(users.id, staffId));
  if (them && !canManage(me.role, them.role)) return notYours;
  const [gone] = await db
    .delete(users)
    // Still the role it was checked against a moment ago.
    .where(and(eq(users.id, staffId), eq(users.role, them?.role ?? "staff")))
    .returning({ name: users.name, email: users.email });
  if (gone) {
    await audit(me, {
      area: "staff",
      action: "staff.deleted",
      subject: gone.name,
      summary: `Deleted the account ${gone.email}`,
    });
  }
  redirect("/staff");
}
