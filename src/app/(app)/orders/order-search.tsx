"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// The search box above the orders. The list follows what is typed, a moment
// after the last key: there is no button to press.
export function OrderSearch({ q }: { q: string }) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const [focused, setFocused] = useState(false);
  const [waiting, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The search changed from somewhere else (a filter, the menu, the Back
  // button): show that. While someone is typing, what they typed wins.
  const [seen, setSeen] = useState(q);
  if (q !== seen) {
    setSeen(q);
    if (!focused) setText(q);
  }

  const show = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // Everything else in the address (the filter, the sorting, the view) stays.
    const query = new URLSearchParams(window.location.search);
    const wanted = value.trim();
    if ((query.get("q") ?? "") === wanted) return;
    if (wanted) query.set("q", wanted);
    else query.delete("q");
    query.delete("page");
    const rest = query.toString();
    startTransition(() => {
      router.replace(rest ? `/orders?${rest}` : "/orders", { scroll: false });
    });
  };
  const typed = (value: string) => {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => show(value), 250);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <form
      role="search"
      data-order-search
      className="relative ml-auto w-64 max-w-full"
      onSubmit={(event) => {
        event.preventDefault();
        show(text);
      }}
    >
      {waiting ? (
        <LoaderCircle className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 animate-spin text-brand" />
      ) : (
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-stone-400" />
      )}
      <input
        name="q"
        value={text}
        onChange={(event) => typed(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label="Search orders"
        placeholder="FO number, name or phone"
        autoComplete="off"
        className="input w-full pr-8 pl-8"
      />
      {text && (
        <button
          type="button"
          aria-label="Clear the search"
          onClick={() => {
            setText("");
            show("");
          }}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
        >
          <X className="size-3.5" />
        </button>
      )}
    </form>
  );
}
