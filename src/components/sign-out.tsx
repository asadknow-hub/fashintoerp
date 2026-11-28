"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { logout } from "@/app/auth-actions";

// Signs out with a full page load (not a soft change of page), so nothing of
// this person stays on the screen or in the browser for the next one:
// open pages, typed text, unfinished orders.
export function SignOut({ className }: { className: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          for (const key of Object.keys(window.localStorage)) {
            if (key.startsWith("fashinto:")) window.localStorage.removeItem(key);
          }
        } catch {
          // Storage can be blocked; signing out still works.
        }
        try {
          await logout();
        } finally {
          // On purpose a full page load, not a soft change of page: see above.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
        }
      }}
      className={className}
    >
      <LogOut className="size-4 text-stone-500" /> {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
