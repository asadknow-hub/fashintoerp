"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef } from "react";
import type { FormAction } from "@/components/action-form";

export function ReplyBox({
  action,
  quickReplies,
}: {
  action: FormAction;
  quickReplies: { id: string; title: string; body: string }[];
}) {
  const [state, run, pending] = useActionState(action, null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state?.ok && box.current) box.current.value = "";
  }, [state]);

  const send = () => {
    if (!box.current?.value.trim() || pending) return;
    const data = new FormData();
    data.set("body", box.current.value);
    startTransition(() => run(data));
  };

  return (
    <form
      className="space-y-2 border-t border-stone-200 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {state?.error && (
        <p role="alert" className="text-xs text-rose-700">
          {state.error}
        </p>
      )}
      <textarea
        ref={box}
        name="body"
        rows={2}
        placeholder="Write a reply…"
        aria-label="Reply"
        className="input resize-none"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center gap-2">
        {quickReplies.length > 0 && (
          <select
            aria-label="Insert a saved reply"
            className="input w-auto max-w-48 py-1.5 text-xs"
            value=""
            onChange={(event) => {
              const picked = quickReplies.find((q) => q.id === event.target.value);
              if (picked && box.current) {
                box.current.value = picked.body;
                box.current.focus();
              }
            }}
          >
            <option value="">Saved replies…</option>
            {quickReplies.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
          </select>
        )}
        <button type="submit" disabled={pending} className="btn ml-auto">
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}

// Checks for new messages every few seconds while the tab is visible.
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}

// Keeps the newest message in view.
export function ScrollToEnd({ marker }: { marker: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [marker]);
  return <div ref={ref} />;
}
