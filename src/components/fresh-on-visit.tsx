"use client";

import { useRouter } from "next/navigation";
import { Fragment } from "react";

// Pages stay alive in the background after you leave them. For "new …" forms
// that would bring back the entry you just saved, so this starts them clean
// every time you open them from a link (the browser's Back button still
// returns to what you had).
export function FreshOnVisit({ children }: { children: React.ReactNode }) {
  const { bfcacheId } = useRouter();
  return <Fragment key={bfcacheId}>{children}</Fragment>;
}
