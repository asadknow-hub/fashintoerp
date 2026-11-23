import type { NextRequest } from "next/server";
import { parseWebhook, receiveMessage, verifySignature } from "@/lib/chat";

// Meta calls this once when you connect the webhook, to check it is yours.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (
    token &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === token
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// Meta calls this every time a customer sends a message on
// WhatsApp, Instagram or Messenger.
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  for (const incoming of parseWebhook(payload)) {
    await receiveMessage(incoming);
  }
  return new Response("OK", { status: 200 });
}
