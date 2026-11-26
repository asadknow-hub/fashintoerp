import { and, asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { conversations, messages, quickReplies, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDateTime, isUuid } from "@/lib/format";
import { getPrefs } from "@/lib/settings";
import { reply, setOpen } from "./actions";
import { AutoRefresh, ReplyBox, ScrollToEnd } from "./reply-box";
import { SubmitButton } from "@/components/submit-button";

const channelLabel = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
} as const;

const channelTone = {
  whatsapp: "green",
  instagram: "red",
  messenger: "blue",
} as const;

export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  await requireUser();
  const params = await searchParams;
  const { timezone } = await getPrefs();
  const showClosed = params.view === "closed";
  const selectedId =
    typeof params.c === "string" && isUuid(params.c) ? params.c : null;

  // Opening a chat marks it as read.
  if (selectedId) {
    await db
      .update(conversations)
      .set({ unread: 0 })
      .where(eq(conversations.id, selectedId));
  }

  const [list, [selected]] = await Promise.all([
    db
      .select()
      .from(conversations)
      .where(eq(conversations.open, !showClosed))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(100),
    selectedId
      ? db.select().from(conversations).where(eq(conversations.id, selectedId))
      : Promise.resolve([]),
  ]);

  const [thread, saved] = selected
    ? await Promise.all([
        db
          .select({
            id: messages.id,
            direction: messages.direction,
            body: messages.body,
            status: messages.status,
            error: messages.error,
            automated: messages.automated,
            createdAt: messages.createdAt,
            sender: users.name,
          })
          .from(messages)
          .leftJoin(users, eq(users.id, messages.userId))
          .where(and(eq(messages.conversationId, selected.id)))
          .orderBy(desc(messages.createdAt))
          .limit(200)
          .then((rows) => rows.reverse()),
        db.select().from(quickReplies).orderBy(asc(quickReplies.title)),
      ])
    : [[], []];

  const href = (id?: string) => {
    const query = new URLSearchParams();
    if (showClosed) query.set("view", "closed");
    if (id) query.set("c", id);
    const qs = query.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  };
  const displayName = (c: typeof conversations.$inferSelect) =>
    c.contactName || (c.channel === "whatsapp" ? `+${c.externalId}` : "Customer");

  return (
    <>
      <AutoRefresh />
      <PageHeader title="Inbox" subtitle="All your customer chats in one place." />

      <div className="grid gap-4 lg:h-[calc(100vh-11rem)] lg:grid-cols-[20rem_1fr]">
        <aside className={"card flex min-h-0 flex-col " + (selected ? "hidden lg:flex" : "")}>
          <div className="flex gap-1 border-b border-stone-200 p-2">
            {[
              { label: "Open", closed: false },
              { label: "Closed", closed: true },
            ].map((tab) => (
              <Link
                key={tab.label}
                href={tab.closed ? "/inbox?view=closed" : "/inbox"}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-medium " +
                  (showClosed === tab.closed
                    ? "bg-stone-900 text-white"
                    : "text-stone-600 hover:bg-stone-100")
                }
              >
                {tab.label}
              </Link>
            ))}
          </div>
          <div className="min-h-0 flex-1 divide-y divide-stone-100 overflow-y-auto">
            {list.length === 0 && (
              <p className="p-4 text-sm text-stone-500">
                {showClosed
                  ? "No closed chats."
                  : "No chats yet. Messages from WhatsApp, Instagram and Messenger will appear here once connected in Settings."}
              </p>
            )}
            {list.map((c) => (
              <Link
                key={c.id}
                href={href(c.id)}
                className={
                  "block px-3 py-1.5 hover:bg-stone-50 " +
                  (c.id === selected?.id ? "bg-stone-100" : "")
                }
              >
                <div className="flex items-center gap-2">
                  <span
                    className={
                      "min-w-0 flex-1 truncate text-sm " +
                      (c.unread > 0 ? "font-semibold" : "font-medium")
                    }
                  >
                    {displayName(c)}
                  </span>
                  {c.unread > 0 && (
                    <span className="rounded-full bg-rose-700 px-1.5 text-xs font-semibold text-white">
                      {c.unread}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-stone-500">
                  {c.lastMessage ?? "…"}
                </p>
                <div className="mt-1.5 flex items-center justify-between">
                  <Badge tone={channelTone[c.channel]}>{channelLabel[c.channel]}</Badge>
                  <span className="text-xs text-stone-400">
                    {formatDateTime(c.lastMessageAt, timezone)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </aside>

        {selected ? (
          <section className="card flex min-h-[28rem] min-w-0 flex-col">
            <header className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-3 py-1.5">
              <Link href={href()} className="text-sm text-stone-500 lg:hidden">
                ←
              </Link>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{displayName(selected)}</p>
                <p className="text-xs text-stone-500">
                  {channelLabel[selected.channel]}
                  {selected.channel === "whatsapp" && ` · +${selected.externalId}`}
                </p>
              </div>
              <Link
                href={`/orders/new?${new URLSearchParams({
                  name: selected.contactName ?? "",
                  phone: selected.channel === "whatsapp" ? `+${selected.externalId}` : "",
                  source: channelLabel[selected.channel],
                  conversation: selected.id,
                })}`}
                className="btn-secondary btn-sm"
              >
                Create order
              </Link>
              <form action={setOpen.bind(null, selected.id, !selected.open)}>
                <SubmitButton>{selected.open ? "Close chat" : "Reopen"}</SubmitButton>
              </form>
            </header>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-stone-50 px-4 py-4">
              {thread.map((m) => (
                <div
                  key={m.id}
                  className={"flex " + (m.direction === "out" ? "justify-end" : "")}
                >
                  <div className="max-w-[80%]">
                    <p
                      className={
                        "rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap " +
                        (m.direction === "out"
                          ? m.status === "failed"
                            ? "bg-rose-100 text-rose-900"
                            : "bg-stone-900 text-white"
                          : "border border-stone-200 bg-white")
                      }
                    >
                      {m.body}
                    </p>
                    <p
                      className={
                        "mt-0.5 px-1 text-[11px] text-stone-400 " +
                        (m.direction === "out" ? "text-right" : "")
                      }
                    >
                      {m.status === "failed" && (
                        <span className="text-rose-700">Not delivered · </span>
                      )}
                      {m.automated ? "Auto reply · " : m.sender ? `${m.sender} · ` : ""}
                      {formatDateTime(m.createdAt, timezone)}
                    </p>
                  </div>
                </div>
              ))}
              <ScrollToEnd marker={thread.at(-1)?.id ?? ""} />
            </div>

            <ReplyBox
              key={selected.id}
              action={reply.bind(null, selected.id)}
              quickReplies={saved}
            />
          </section>
        ) : (
          <div className="hidden lg:block">
            <Empty title="Pick a chat">Choose a conversation on the left to read and reply.</Empty>
          </div>
        )}
      </div>
    </>
  );
}
