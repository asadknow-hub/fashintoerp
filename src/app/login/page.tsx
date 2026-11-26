import { count } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { login } from "@/app/auth-actions";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getUser } from "@/lib/auth";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mb-6 text-sm text-stone-500">
          Inventory, orders and chats in one place.
        </p>
        <Suspense>
          <Gate />
        </Suspense>
        <ActionForm action={login} submit="Sign in" className="card space-y-4 p-6">
          <Field label="Email">
            <input name="email" type="email" required autoComplete="email" className="input" />
          </Field>
          <Field label="Password">
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="input"
            />
          </Field>
        </ActionForm>
        <Link href="/recover" className="mt-3 inline-block text-sm text-stone-600 hover:underline">
          Forgot your password?
        </Link>
      </div>
    </main>
  );
}

// Sends people to the right place: setup if the system is brand new,
// or the dashboard if they are already signed in.
async function Gate() {
  if (await getUser()) redirect("/");
  const [{ total }] = await db.select({ total: count() }).from(users);
  if (total === 0) redirect("/setup");
  return null;
}
