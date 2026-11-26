import { asc } from "drizzle-orm";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { autoReplies, quickReplies } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  addAutoReply,
  addQuickReply,
  deleteAutoReply,
  deleteQuickReply,
  toggleAutoReply,
} from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function AutomationsPage() {
  await requireUser();
  const [rules, saved] = await Promise.all([
    db.select().from(autoReplies).orderBy(asc(autoReplies.createdAt)),
    db.select().from(quickReplies).orderBy(asc(quickReplies.title)),
  ]);

  return (
    <>
      <PageHeader
        title="Auto replies"
        subtitle="Answer common questions without typing."
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="space-y-3">
          <div>
            <h2 className="text-[11px] font-bold tracking-wider text-stone-700 uppercase">Automatic replies</h2>
            <p className="text-sm text-stone-500">
              When a customer&apos;s message contains the keyword, the reply is
              sent instantly.
            </p>
          </div>
          {rules.map((rule) => (
            <div key={rule.id} className="card p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  If message contains{" "}
                  <span className="font-semibold">“{rule.keyword}”</span>
                </span>
                <span className="ml-auto">
                  <Badge tone={rule.active ? "green" : "gray"}>
                    {rule.active ? "On" : "Off"}
                  </Badge>
                </span>
              </div>
              <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm whitespace-pre-wrap text-stone-700">
                {rule.reply}
              </p>
              <div className="mt-3 flex gap-2">
                <form action={toggleAutoReply.bind(null, rule.id)}>
                  <SubmitButton>Turn {rule.active ? "off" : "on"}</SubmitButton>
                </form>
                <form action={deleteAutoReply.bind(null, rule.id)}>
                  <SubmitButton>Delete</SubmitButton>
                </form>
              </div>
            </div>
          ))}
          <ActionForm action={addAutoReply} submit="Add automatic reply" className="card space-y-2 p-3">
            <Field label="Keyword" hint="For example: price, delivery, size chart">
              <input name="keyword" required className="input" />
            </Field>
            <Field label="Reply to send">
              <textarea name="reply" required rows={3} className="input" />
            </Field>
          </ActionForm>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-[11px] font-bold tracking-wider text-stone-700 uppercase">Saved replies</h2>
            <p className="text-sm text-stone-500">
              Messages your team can insert with one click in the inbox.
            </p>
          </div>
          {saved.map((item) => (
            <div key={item.id} className="card p-3">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm whitespace-pre-wrap text-stone-700">
                {item.body}
              </p>
              <form action={deleteQuickReply.bind(null, item.id)} className="mt-3">
                <SubmitButton>Delete</SubmitButton>
              </form>
            </div>
          ))}
          <ActionForm action={addQuickReply} submit="Add saved reply" className="card space-y-2 p-3">
            <Field label="Name" hint="Only your team sees this.">
              <input name="title" required placeholder="Delivery time" className="input" />
            </Field>
            <Field label="Message">
              <textarea name="body" required rows={3} className="input" />
            </Field>
          </ActionForm>
        </section>
      </div>
    </>
  );
}
