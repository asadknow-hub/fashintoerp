"use client";

import { useActionState, useEffect, useRef, startTransition } from "react";

export type ActionState = { error?: string; ok?: string } | null;
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
}: {
  action: FormAction;
  children?: React.ReactNode;
  submit: string;
  className?: string;
  submitClassName?: string;
  // Wraps the message and button, for forms that need them laid out specially.
  footerClassName?: string;
  confirm?: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
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
          <button type="submit" disabled={pending} className={submitClassName}>
            {pending ? "Saving…" : submit}
          </button>
        </div>
      </Footer>
    </form>
  );
}

function Footer({ className, children }: { className?: string; children: React.ReactNode }) {
  return className ? <div className={className}>{children}</div> : <>{children}</>;
}
