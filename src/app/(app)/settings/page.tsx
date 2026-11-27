import { asc, eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { deliveryCompanies, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { channelStatus, webhookReady } from "@/lib/chat";
import { CURRENCY, formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { changePassword, createRecoveryCode, updateBusiness } from "./actions";
import { Companies } from "./companies";

export default async function SettingsPage() {
  const user = await requireUser();
  const owner = user.role === "owner";
  const [business, companies, [me]] = await Promise.all([
    getSettings(),
    db
      .select({
        id: deliveryCompanies.id,
        name: deliveryCompanies.name,
        rate: deliveryCompanies.rate,
        openedFee: deliveryCompanies.openedFee,
      })
      .from(deliveryCompanies)
      .where(eq(deliveryCompanies.active, true))
      .orderBy(asc(deliveryCompanies.name)),
    db
      .select({ hasCode: sql<boolean>`${users.recoveryHash} is not null` })
      .from(users)
      .where(eq(users.id, user.id)),
  ]);
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const webhookUrl = `${protocol}://${host}/api/webhooks/meta`;
  const channels = channelStatus();

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-3 flex flex-wrap gap-2" data-settings-links>
        {owner && (
          <Link href="/staff" className="btn-secondary">
            Staff and their logins
          </Link>
        )}
        <Link href="/inbox" className="btn-secondary">
          Chat inbox
        </Link>
        <Link href="/automations" className="btn-secondary">
          Auto replies
        </Link>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {owner && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-stone-900">
              Business
            </h2>
            <ActionForm
              action={updateBusiness}
              submit="Save"
              className="card space-y-2 p-3"
            >
              <Field label="Business name">
                <input
                  name="businessName"
                  defaultValue={business?.businessName}
                  required
                  className="input"
                />
              </Field>
              <Field label="Currency" hint="The system works in AED only.">
                <input value="AED — UAE Dirham" disabled className="input bg-stone-100" />
              </Field>
              <Field
                label="Time zone"
                hint="Used for the dates and times you see."
              >
                <select
                  name="timezone"
                  defaultValue={business?.timezone}
                  className="input"
                >
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
          <h2 className="text-sm font-bold text-stone-900">
            Your password
          </h2>
          <ActionForm
            action={changePassword}
            submit="Change password"
            className="card space-y-2 p-3"
          >
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

        <section className="space-y-3">
          <h2 className="text-sm font-bold text-stone-900">
            If you forget your password
          </h2>
          <ActionForm
            action={createRecoveryCode}
            submit={me?.hasCode ? "Make a new code" : "Create my recovery code"}
            submitClassName={me?.hasCode ? "btn-secondary" : "btn"}
            confirm={
              me?.hasCode
                ? "Your old code will stop working. Make a new one?"
                : undefined
            }
            className="card space-y-2 p-3"
          >
            <p className="text-sm text-stone-600">
              A recovery code lets you set a new password from the sign-in page.
              Write it down and keep it somewhere safe; it works once.
            </p>
            <p
              className={
                "text-sm font-medium " +
                (me?.hasCode ? "text-emerald-700" : "text-amber-700")
              }
            >
              {me?.hasCode
                ? "You have a recovery code."
                : "You don't have one yet. Without it, a forgotten password can lock you out."}
            </p>
          </ActionForm>
        </section>

        <section className="scroll-mt-20 space-y-3" id="delivery-companies">
          <h2 className="text-sm font-bold text-stone-900">Delivery companies</h2>
          <Companies
            canEdit={owner}
            currency={CURRENCY}
            companies={companies.map((company) => ({
              ...company,
              rate: Number(company.rate),
              openedFee: Number(company.openedFee),
            }))}
          />
          <p className="text-xs text-stone-500">
            The delivery charge is what the company usually bills you for one order. It is asked
            again when an order is marked delivered, since some areas cost more. &quot;Opened&quot;
            is what they bill when a customer opens the parcel and then refuses it.
          </p>
        </section>

        {owner && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-stone-900">
              Safety copy of your data
            </h2>
            <div className="card space-y-2 p-3">
              <p className="text-sm text-stone-600">
                Downloads everything (products, stock, orders, customers, chats)
                as one file. Keep it somewhere safe, for example in your email
                or Google Drive. Do this every week.
              </p>
              <p className="text-sm font-medium">
                {business?.lastBackupAt
                  ? `Last downloaded: ${formatDateTime(business.lastBackupAt, business.timezone)}`
                  : "Never downloaded yet."}
              </p>
              <a href="/api/backup" download className="btn">
                Download backup
              </a>
            </div>
          </section>
        )}

        {owner && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-stone-900">
              Chat channels
            </h2>
            <div className="card divide-y divide-stone-100">
              {(
                [
                  ["whatsapp", "WhatsApp"],
                  ["instagram", "Instagram"],
                  ["messenger", "Facebook Messenger"],
                ] as const
              ).map(([key, label]) => (
                <div
                  key={key}
                  className="flex items-center justify-between px-3 py-1.5 text-sm"
                >
                  <span>{label}</span>
                  <Badge tone={channels[key] ? "green" : "gray"}>
                    {channels[key] ? "Connected" : "Not connected"}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="card space-y-2 p-3 text-sm text-stone-600">
              <p>
                Chats connect through a Meta (Facebook) business account. This
                is a one-time setup — ask your developer or Claude to do it with
                you.
              </p>
              <p className="label mt-3">Webhook address to give Meta</p>
              <p className="rounded-lg bg-stone-50 px-3 py-2 font-mono text-xs break-all text-stone-800">
                {webhookUrl}
              </p>
              <p className="text-xs">
                Receiving messages:{" "}
                {webhookReady() ? "ready" : "not set up yet"}.
              </p>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
