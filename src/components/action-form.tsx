"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, startTransition, useTransition } from "react";

// "go" is the page to open after a successful save.
export type ActionState = { error?: string; ok?: string; go?: string } | null;
export type FormAction = (
  state: ActionState,
  form: FormData,
) => Promise<ActionState>;

// A form that runs a server action, shows its error or success message,
// and keeps what the person typed if something goes wrong.
export function ActionForm({
  action,
  children,
  submit,
  className,
  submitClassName = "btn",
  footerClassName,
  confirm,
  disabled = false,
  onSaved,
  working = "Saving…",
}: {
  action: FormAction;
  children?: React.ReactNode;
  submit: string;
  className?: string;
  submitClassName?: string;
  // Wraps the message and button, for forms that need them laid out specially.
  footerClassName?: string;
  confirm?: string;
  // Holds the button back while something on the form still needs fixing.
  disabled?: boolean;
  // Runs after a successful save, before moving to the next page.
  onSaved?: () => void;
  // What the button says while it works.
  working?: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const saved = useRef(onSaved);
  // Each result is acted on once. Pages stay alive while hidden and are
  // shown again later: without this, coming back would clear what was typed
  // since (after a save) or jump forward again (after a save that moved on).
  const handled = useRef<ActionState>(null);
  // The button stays busy until the next page is showing, and is ready
  // again if this page is come back to.
  const [leaving, startLeaving] = useTransition();
  useEffect(() => {
    saved.current = onSaved;
  });

  useEffect(() => {
    if (handled.current === state) return;
    handled.current = state;
    if (state?.ok) ref.current?.reset();
    if (state?.go) {
      saved.current?.();
      const go = state.go;
      startLeaving(() => router.push(go));
    }
  }, [state, router]);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => run(data));
      }}
    >
      {children}
      <Footer className={footerClassName}>
        {state?.error && (
          <p role="alert" className="text-sm text-rose-700">
            {state.error}
          </p>
        )}
        {state?.ok && (
          <p role="status" className="text-sm text-emerald-700">
            {state.ok}
          </p>
        )}
        <div>
          <button
            type="submit"
            disabled={pending || disabled || leaving}
            className={submitClassName}
          >
            {pending || leaving ? working : submit}
          </button>
        </div>
      </Footer>
    </form>
  );
}

function Footer({ className, children }: { className?: string; children: React.ReactNode }) {
  return className ? <div className={className}>{children}</div> : <>{children}</>;
}
