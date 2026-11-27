"use client";

import { LoadError } from "@/components/load-error";

// A page inside the app failed to load; the menu and top bar stay usable.
export default function PageError(props: { error: unknown; retry: () => void }) {
  return <LoadError {...props} />;
}
