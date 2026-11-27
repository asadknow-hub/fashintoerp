"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

// When this screen last tried again by itself. Kept outside the component so
// a page that keeps failing can't retry forever.
let triedAt: number[] = [];

// Shown when a page fails to load. A short hiccup (the database being busy
// for a second) usually clears by itself, so it tries again twice before
// asking the person to.
export function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  const [waiting, setWaiting] = useState(true);

  useEffect(() => {
    console.error(error);
    const now = Date.now();
    triedAt = triedAt.filter((time) => now - time < 30_000);
    if (triedAt.length >= 2) {
      const stop = setTimeout(() => setWaiting(false), 0);
      return () => clearTimeout(stop);
    }
    const timer = setTimeout(
      () => {
        triedAt.push(Date.now());
        retry();
      },
      triedAt.length === 0 ? 1200 : 3000,
    );
    return () => clearTimeout(timer);
  }, [error, retry]);

  const digest =
    error instanceof Error && "digest" in error ? String((error as { digest?: unknown }).digest) : "";

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4" data-load-error>
      <div className="card w-full max-w-md p-6 text-center">
        <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <TriangleAlert className="size-6" />
        </span>
        <h1 className="text-lg font-extrabold tracking-tight">This page didn&apos;t load</h1>
        <p className="mt-1 text-sm text-stone-600">
          {waiting
            ? "The system was busy for a moment. Trying again…"
            : "It is still not loading. Nothing you typed elsewhere is lost. Check your internet and try again."}
        </p>
        <button
          type="button"
          onClick={() => {
            triedAt = [];
            setWaiting(true);
            retry();
          }}
          className="btn mt-4"
        >
          <RefreshCw className={"size-4 " + (waiting ? "animate-spin" : "")} /> Try again
        </button>
        {digest && <p className="mt-3 text-[11px] text-stone-400">Error {digest}</p>}
      </div>
    </div>
  );
}
