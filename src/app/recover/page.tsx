import Link from "next/link";
import { recover } from "@/app/auth-actions";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";

export default function RecoverPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Forgot your password?</h1>
        <p className="mb-4 text-sm text-stone-500">
          Enter the recovery code you saved from Settings, and choose a new
          password. The code works once.
        </p>
        <ActionForm action={recover} submit="Set new password" working="Please wait…" className="card space-y-3 p-4">
          <Field label="Email">
            <input name="email" type="email" required autoComplete="email" className="input" />
          </Field>
          <Field label="Recovery code">
            <input
              name="code"
              required
              autoComplete="off"
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              className="input font-mono uppercase"
            />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
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
        <p className="mt-3 text-xs text-stone-500">
          No code? An Owner or the System Admin can set a new password for you on the Staff page.
        </p>
        <Link href="/login" className="mt-2 inline-block text-sm text-stone-600 hover:underline">
          ← Back to sign in
        </Link>
      </div>
    </main>
  );
}
