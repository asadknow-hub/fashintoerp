"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { sendReply } from "@/lib/chat";
import { text } from "@/lib/format";

export async function reply(
  conversationId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const body = text(form, "body");
  if (!body) return { error: "Type a message first." };
  if (body.length > 4000) return { error: "That message is too long." };

  const result = await sendReply({ conversationId, body, userId: user.id });
  refresh();
  if (result.error) return { error: `Not delivered: ${result.error}` };
  return { ok: "sent" };
}

export async function setOpen(conversationId: string, open: boolean) {
  await requireUser();
  await db
    .update(conversations)
    .set({ open, unread: 0 })
    .where(eq(conversations.id, conversationId));
  refresh();
}
