import { count } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { setup } from "@/app/auth-actions";
import { ActionForm } from "@/components/action-form";
import { TimeZoneField } from "@/components/time-zone-field";
import { Field } from "@/components/ui";
import { db } from "@/db";
import { users } from "@/db/schema";

export default function SetupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Welcome — let&apos;s set up your business
        </h1>
        <p className="mb-6 text-sm text-stone-500">
          This creates your System Admin account. You can add your team later.
        </p>
        <Suspense>
          <Gate />
        </Suspense>
        <ActionForm
          action={setup}
          submit="Create my account"
          className="card space-y-4 p-6"
        >
          <TimeZoneField />
          <Field label="Business name">
            <input name="businessName" required className="input" />
          </Field>
          <Field label="Your name">
            <input name="name" required autoComplete="name" className="input" />
          </Field>
          <Field label="Email">
            <input name="email" type="email" required autoComplete="email" className="input" />
          </Field>
          <Field label="Password" hint="At least 8 characters.">
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
            />
          </Field>
        </ActionForm>
      </div>
    </main>
  );
}

// Setup is only available while there are no accounts.
async function Gate() {
  const [{ total }] = await db.select({ total: count() }).from(users);
  if (total > 0) redirect("/login");
  return null;
}
