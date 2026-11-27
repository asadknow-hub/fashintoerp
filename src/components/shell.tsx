"use client";

import { Menu as MenuIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

const KEY = "fashinto:menu-hidden";
const CHANGED = "fashinto:menu";

function subscribe(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", listener);
  };
}

function readHidden() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// The frame around every page: the menu on the left and the bar on top.
// The ☰ button hides the menu on a computer (and remembers that), and
// slides it in over the page on a phone.
export function Shell({
  sidebar,
  bar,
  children,
}: {
  sidebar: React.ReactNode;
  bar: React.ReactNode;
  children: React.ReactNode;
}) {
  const hidden = useSyncExternalStore(subscribe, readHidden, () => false);
  const [drawer, setDrawer] = useState(false);

  const toggle = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      try {
        localStorage.setItem(KEY, hidden ? "0" : "1");
      } catch {}
      window.dispatchEvent(new Event(CHANGED));
    } else {
      setDrawer((open) => !open);
    }
  };

  return (
    <div className="min-h-screen md:flex">
      {drawer && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setDrawer(false)}
          className="fixed inset-0 z-30 bg-stone-900/40 md:hidden"
        />
      )}
      <aside
        data-sidebar
        // Picking a page closes the phone menu.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) setDrawer(false);
        }}
        className={
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-stone-200 bg-stone-100 px-3 py-4 transition-transform md:sticky md:top-0 md:z-20 md:h-screen md:w-52 md:shrink-0 md:translate-x-0 md:self-start md:bg-stone-100/70 " +
          (drawer ? "translate-x-0 shadow-xl" : "-translate-x-full") +
          (hidden ? " md:hidden" : "")
        }
      >
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-stone-200 bg-white/85 px-3 backdrop-blur md:gap-3 md:px-5">
          <button
            type="button"
            aria-label="Menu"
            onClick={toggle}
            className="-ml-1 cursor-pointer rounded-lg p-1.5 text-stone-700 hover:bg-stone-100"
          >
            <MenuIcon className="size-5" strokeWidth={1.9} />
          </button>
          {bar}
        </header>
        <main className="min-w-0 flex-1 px-3 py-4 md:px-5">{children}</main>
      </div>
    </div>
  );
}
