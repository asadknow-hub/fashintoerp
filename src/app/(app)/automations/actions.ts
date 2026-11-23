"use server";

import { eq, not } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { autoReplies, quickReplies } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { text } from "@/lib/format";

export async function addAutoReply(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireUser();
  const keyword = text(form, "keyword");
  const reply = text(form, "reply");
  if (!keyword || !reply) return { error: "Fill in both the keyword and the reply." };
  if (reply.length > 4000) return { error: "That reply is too long." };
  await db.insert(autoReplies).values({ keyword, reply });
  refresh();
  return { ok: "Added." };
}

export async function toggleAutoReply(id: string) {
  await requireUser();
  await db
    .update(autoReplies)
    .set({ active: not(autoReplies.active) })
    .where(eq(autoReplies.id, id));
  refresh();
}

export async function deleteAutoReply(id: string) {
  await requireUser();
  await db.delete(autoReplies).where(eq(autoReplies.id, id));
  refresh();
}

export async function addQuickReply(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireUser();
  const title = text(form, "title");
  const body = text(form, "body");
  if (!title || !body) return { error: "Fill in both the name and the message." };
  if (body.length > 4000) return { error: "That message is too long." };
  await db.insert(quickReplies).values({ title, body });
  refresh();
  return { ok: "Added." };
}

export async function deleteQuickReply(id: string) {
  await requireUser();
  await db.delete(quickReplies).where(eq(quickReplies.id, id));
  refresh();
}
