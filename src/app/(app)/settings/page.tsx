import { asc } from "drizzle-orm";
import { headers } from "next/headers";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { channelStatus, webhookReady } from "@/lib/chat";
import { CURRENCIES } from "@/lib/currencies";
import { getSettings } from "@/lib/settings";
import {
  addTeamMember,
  changePassword,
  setMemberActive,
  updateBusiness,
} from "./actions";

export default async function SettingsPage() {
  const user = await requireUser();
  const owner = user.role === "owner";
  const business = await getSettings();
  const team = owner
    ? await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          active: users.active,
        })
        .from(users)
        .orderBy(asc(users.createdAt))
    : [];

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const webhookUrl = `${protocol}://${host}/api/webhooks/meta`;
  const channels = channelStatus();

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-8 lg:grid-cols-2">
        {owner && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Business</h2>
            <ActionForm action={updateBusiness} submit="Save" className="card space-y-3 p-4">
              <Field label="Business name">
                <input
                  name="businessName"
                  defaultValue={business?.businessName}
                  required
                  className="input"
                />
              </Field>
              <Field label="Currency">
                <select name="currency" defaultValue={business?.currency} className="input">
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Time zone" hint="Used for the dates and times you see.">
                <select name="timezone" defaultValue={business?.timezone} className="input">
                  {Intl.supportedValuesOf("timeZone")
                    .concat("UTC")
                    .map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.replaceAll("_", " ")}
                      </option>
                    ))}
                </select>
              </Field>
            </ActionForm>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Your password</h2>
          <ActionForm action={changePassword} submit="Change password" className="card space-y-3 p-4">
            <Field label="Current password">
              <input
                name="current"
                type="password"
                required
                autoComplete="current-password"
                className="input"
              />
            </Field>
            <Field label="New password" hint="At least 8 characters.">
              <input
                name="next"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="input"
              />
            </Field>
          </ActionForm>
        </section>

        {owner && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Team</h2>
            <div className="card divide-y divide-stone-100">
              {team.map((member) => (
                <div key={member.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{member.name}</p>
                    <p className="truncate text-xs text-stone-500">{member.email}</p>
                  </div>
                  {member.role === "owner" ? (
                    <Badge>Owner</Badge>
                  ) : (
                    <>
                      <Badge tone={member.active ? "green" : "gray"}>
                        {member.active ? "Active" : "Access off"}
                      </Badge>
                      <form action={setMemberActive.bind(null, member.id, !member.active)}>
                        <button className="btn-secondary btn-sm">
                          {member.active ? "Remove access" : "Give access"}
                        </button>
                      </form>
                    </>
                  )}
                </div>
              ))}
            </div>
            <ActionForm action={addTeamMember} submit="Add team member" className="card space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <input name="name" required className="input" />
                </Field>
                <Field label="Email">
                  <input name="email" type="email" required className="input" />
                </Field>
              </div>
              <Field label="Password for them" hint="They can change it after signing in.">
                <input name="password" type="text" required minLength={8} className="input" />
              </Field>
            </ActionForm>
          </section>
        )}

        {owner && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Chat channels</h2>
            <div className="card divide-y divide-stone-100">
              {(
                [
                  ["whatsapp", "WhatsApp"],
                  ["instagram", "Instagram"],
                  ["messenger", "Facebook Messenger"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>{label}</span>
                  <Badge tone={channels[key] ? "green" : "gray"}>
                    {channels[key] ? "Connected" : "Not connected"}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="card space-y-2 p-4 text-sm text-stone-600">
              <p>
                Chats connect through a Meta (Facebook) business account. This is
                a one-time setup — ask your developer or Claude to do it with you.
              </p>
              <p className="label mt-3">Webhook address to give Meta</p>
              <p className="rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs break-all text-stone-800">
                {webhookUrl}
              </p>
              <p className="text-xs">
                Receiving messages: {webhookReady() ? "ready" : "not set up yet"}.
              </p>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
