"use client";

import { useFormStatus } from "react-dom";

// A form button that reacts the moment it is pressed, so nothing feels stuck
// while the server is working.
export function SubmitButton({
  children,
  className = "btn-secondary btn-sm",
  working = "Working…",
}: {
  children: React.ReactNode;
  className?: string;
  working?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? working : children}
    </button>
  );
}
