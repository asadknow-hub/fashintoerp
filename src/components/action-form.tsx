"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, startTransition } from "react";

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
}) {
  const [state, run, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const saved = useRef(onSaved);
  // Remembers which save has already been followed, so coming back to this
  // page with the browser's Back button doesn't jump forward again.
  const followed = useRef<ActionState>(null);
  useEffect(() => {
    saved.current = onSaved;
  });

  useEffect(() => {
    if (state?.ok) ref.current?.reset();
    if (state?.go && followed.current !== state) {
      followed.current = state;
      saved.current?.();
      router.push(state.go);
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
            disabled={pending || disabled || !!state?.go}
            className={submitClassName}
          >
            {pending || state?.go ? "Saving…" : submit}
          </button>
        </div>
      </Footer>
    </form>
  );
}

function Footer({ className, children }: { className?: string; children: React.ReactNode }) {
  return className ? <div className={className}>{children}</div> : <>{children}</>;
}
