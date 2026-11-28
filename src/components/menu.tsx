"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// A button that opens a small panel under it. The panel closes when you click
// elsewhere, press Escape, or move to another page.
export function Menu({
  label,
  button,
  children,
  align = "right",
}: {
  label: string;
  button: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState("");
  const pathname = usePathname();
  const box = useRef<HTMLDivElement>(null);
  // Moving to another page closes it.
  const shown = open && openedAt === pathname;

  useEffect(() => {
    if (!shown) return;
    const outside = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [shown]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={shown}
        onClick={() => {
          setOpenedAt(pathname);
          setOpen(!shown);
        }}
        className="flex cursor-pointer items-center rounded-lg p-1 hover:bg-stone-100"
      >
        {button}
      </button>
      {shown && (
        <div
          // Choosing something in it closes it, also when that leads to the
          // page that is already open.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setOpen(false);
          }}
          className={
            "card absolute top-full z-40 mt-1.5 w-64 overflow-hidden shadow-lg " +
            (align === "right" ? "right-0" : "left-0")
          }
        >
          {children}
        </div>
      )}
    </div>
  );
}
