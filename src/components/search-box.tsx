"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

// The search box at the top of every page. Pressing "/" jumps into it.
export function SearchBox() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const jump = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", jump);
    return () => document.removeEventListener("keydown", jump);
  }, []);

  return (
    <form
      role="search"
      className="relative min-w-0 flex-1 sm:w-72 sm:flex-none lg:w-80"
      onSubmit={(event) => {
        event.preventDefault();
        const q = input.current?.value.trim();
        if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
      <input
        ref={input}
        name="q"
        aria-label="Search"
        placeholder="Search products, orders, customers…"
        autoComplete="off"
        className="w-full rounded-lg border border-transparent bg-stone-100 py-2 pr-9 pl-9 text-sm outline-none placeholder:text-stone-500 focus:border-brand focus:bg-white focus:ring-1 focus:ring-brand"
      />
      <kbd className="pointer-events-none absolute max-sm:hidden top-1/2 right-2.5 -translate-y-1/2 rounded border border-stone-300 bg-white px-1.5 text-[11px] font-semibold text-stone-500">
        /
      </kbd>
    </form>
  );
}
