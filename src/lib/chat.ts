import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { autoReplies, conversations, messages } from "@/db/schema";

export type Channel = (typeof conversations.channel.enumValues)[number];

const graph = () =>
  `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v24.0"}`;

// Which channels have their keys filled in.
export function channelStatus(): Record<Channel, boolean> {
  const page = !!process.env.META_PAGE_TOKEN;
  return {
    whatsapp: !!process.env.WHATSAPP_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID,
    instagram: page,
    messenger: page,
  };
}

export const webhookReady = () =>
  !!process.env.META_APP_SECRET && !!process.env.META_VERIFY_TOKEN;

/* ---------- Sending ---------- */

async function deliver(channel: Channel, to: string, body: string) {
  if (!channelStatus()[channel]) {
    const label = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger" };
    throw new Error(`${label[channel]} is not connected yet.`);
  }
  const whatsapp = channel === "whatsapp";
  const url = whatsapp
    ? `${graph()}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`
    : `${graph()}/me/messages`;
  const token = whatsapp ? process.env.WHATSAPP_TOKEN : process.env.META_PAGE_TOKEN;
  const payload = whatsapp
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body },
      }
    : { recipient: { id: to }, messaging_type: "RESPONSE", message: { text: body } };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json().catch(() => null)) as {
    messages?: { id?: string }[];
    message_id?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `Sending failed (${response.status}).`);
  }
  return data?.messages?.[0]?.id ?? data?.message_id ?? null;
}

// Sends a reply and saves it in the conversation, whether or not it went through.
export async function sendReply(input: {
  conversationId: string;
  body: string;
  userId?: string | null;
  automated?: boolean;
}) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, input.conversationId));
  if (!conversation) return { error: "Conversation not found." };

  let externalId: string | null = null;
  let error: string | null = null;
  try {
    externalId = await deliver(
      conversation.channel,
      conversation.externalId,
      input.body,
    );
  } catch (err) {
    error = err instanceof Error ? err.message : "Sending failed.";
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(messages)
      .values({
        conversationId: conversation.id,
        direction: "out",
        body: input.body,
        status: error ? "failed" : "sent",
        error,
        externalId,
        userId: input.userId ?? null,
        automated: input.automated ?? false,
      })
      .onConflictDoNothing();
    await tx
      .update(conversations)
      .set({
        lastMessage: input.body,
        lastMessageAt: new Date(),
        // A reply from the team means the chat has been dealt with.
        ...(input.automated ? {} : { unread: 0 }),
      })
      .where(eq(conversations.id, conversation.id));
  });
  return error ? { error } : {};
}

/* ---------- Receiving ---------- */

export type Incoming = {
  channel: Channel;
  from: string;
  name: string | null;
  body: string;
  messageId: string;
};

// Saves a customer message. Safe to call twice with the same message.
export async function receiveMessage(incoming: Incoming) {
  const conversationId = await db.transaction(async (tx) => {
    const [conversation] = await tx
      .insert(conversations)
      .values({
        channel: incoming.channel,
        externalId: incoming.from,
        contactName: incoming.name,
        unread: 0,
      })
      .onConflictDoUpdate({
        target: [conversations.channel, conversations.externalId],
        set: {
          contactName: sql`coalesce(excluded.contact_name, ${conversations.contactName})`,
        },
      })
      .returning({ id: conversations.id });

    const saved = await tx
      .insert(messages)
      .values({
        conversationId: conversation.id,
        direction: "in",
        body: incoming.body,
        status: "received",
        externalId: incoming.messageId,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id });
    if (saved.length === 0) return null; // already had this message

    await tx
      .update(conversations)
      .set({
        open: true,
        unread: sql`${conversations.unread} + 1`,
        lastMessage: incoming.body,
        lastMessageAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id));
    return conversation.id;
  });
  if (!conversationId) return;

  // Auto reply: first active rule whose keyword appears in the message.
  const [rule] = await db
    .select({ reply: autoReplies.reply })
    .from(autoReplies)
    .where(
      and(
        eq(autoReplies.active, true),
        sql`position(lower(${autoReplies.keyword}) in lower(${incoming.body})) > 0`,
      ),
    )
    .orderBy(autoReplies.createdAt)
    .limit(1);
  if (rule) {
    await sendReply({ conversationId, body: rule.reply, automated: true });
  }
}

export function verifySignature(rawBody: string, header: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  typeof value === "object" && value !== null ? (value as Json) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

// Turns what Meta sends us into a simple list of customer messages.
export function parseWebhook(payload: unknown): Incoming[] {
  const root = obj(payload);
  const kind = root.object;
  const result: Incoming[] = [];

  for (const entryRaw of arr(root.entry)) {
    const entry = obj(entryRaw);

    if (kind === "whatsapp_business_account") {
      for (const change of arr(entry.changes)) {
        const value = obj(obj(change).value);
        const names = new Map(
          arr(value.contacts).map((c) => [
            str(obj(c).wa_id),
            str(obj(obj(c).profile).name) || null,
          ]),
        );
        for (const messageRaw of arr(value.messages)) {
          const message = obj(messageRaw);
          const from = str(message.from);
          const messageId = str(message.id);
          if (!from || !messageId) continue;
          const type = str(message.type);
          const body =
            str(obj(message.text).body) ||
            str(obj(obj(message.interactive).button_reply).title) ||
            str(obj(obj(message.interactive).list_reply).title) ||
            str(obj(message.button).text) ||
            `[${type || "message"}]`;
          result.push({
            channel: "whatsapp",
            from,
            name: names.get(from) ?? null,
            body,
            messageId,
          });
        }
      }
    }

    if (kind === "page" || kind === "instagram") {
      for (const eventRaw of arr(entry.messaging)) {
        const event = obj(eventRaw);
        const message = obj(event.message);
        const from = str(obj(event.sender).id);
        const messageId = str(message.mid);
        // Echoes are copies of our own messages; skip them.
        if (!from || !messageId || message.is_echo) continue;
        const body =
          str(message.text) ||
          (arr(message.attachments).length ? "[attachment]" : "[message]");
        result.push({
          channel: kind === "page" ? "messenger" : "instagram",
          from,
          name: null,
          body,
          messageId,
        });
      }
    }
  }
  return result;
}
