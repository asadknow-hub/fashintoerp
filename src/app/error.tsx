"use client";

import { LoadError } from "@/components/load-error";

// Anything else that fails to load, including the menu and top bar.
export default function AppError(props: { error: unknown; retry: () => void }) {
  return <LoadError {...props} />;
}
