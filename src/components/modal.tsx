"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

// A pop-up over the page. It closes with the ✕, the Escape key, or a click
// on the dimmed page behind it.
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    document.addEventListener("keydown", escape);
    // The page behind stays put while the pop-up is open.
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      document.removeEventListener("keydown", escape);
      document.body.style.overflow = scroll;
    };
  }, []);

  return (
    <div
      data-modal
      className="fixed inset-0 z-50 flex cursor-default items-start justify-center overflow-y-auto bg-stone-900/45 p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={
          "card my-auto w-full overflow-hidden shadow-2xl " + (wide ? "max-w-3xl" : "max-w-lg")
        }
      >
        <header className="flex items-start gap-3 border-b border-stone-200 bg-brand-50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-extrabold tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-stone-600">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1 cursor-pointer rounded-lg p-1.5 text-stone-500 hover:bg-stone-200/70 hover:text-stone-900"
          >
            <X className="size-4" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
