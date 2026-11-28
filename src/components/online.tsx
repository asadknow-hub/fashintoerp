"use client";

import { useEffect, useState } from "react";
import { Menu } from "@/components/menu";
import { roleLabel, type Role } from "@/lib/roles";

type Person = {
  id: string;
  name: string;
  role: Role;
  // Seconds since their screen last checked in; nothing if it never did.
  ago: number | null;
  me: boolean;
  online: boolean;
};

const EVERY_MS = 45_000;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

const lastSeen = (ago: number | null) => {
  if (ago === null) return "Not seen yet";
  if (ago < 3600) return `Last seen ${Math.max(1, Math.round(ago / 60))} min ago`;
  if (ago < 86400) return `Last seen ${Math.round(ago / 3600)} h ago`;
  const days = Math.round(ago / 86400);
  return `Last seen ${days} ${days === 1 ? "day" : "days"} ago`;
};

// Tells the system this screen is open ("still here"), now and then. For an
// Owner or the System Admin (`show`) it also shows, in the top bar, who has
// the system open right now, and when everyone else was last seen.
export function Online({ show }: { show: boolean }) {
  const [people, setPeople] = useState<Person[] | null>(null);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch("/api/presence", { method: "POST", cache: "no-store" });
        if (!response.ok || stopped) return;
        const data = (await response.json()) as { people: Person[] };
        if (!stopped) setPeople(data.people);
      } catch {
        // Offline for a moment; the next round will catch up.
      }
    };
    check();
    const timer = setInterval(check, EVERY_MS);
    // Coming back to the tab: say so straight away.
    const back = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  if (!show || people === null) return null;
  const online = people.filter((person) => person.online);
  const away = people.filter((person) => !person.online);
  const row = "flex items-center gap-2.5 px-3 py-2 text-sm";
  const bubble =
    "flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-2 ring-white";

  return (
    <div data-online className="max-sm:hidden">
      <Menu
        label="Who is online"
        button={
          <span className="flex items-center gap-1.5 px-1">
            <span className="flex -space-x-2">
              {online.slice(0, 4).map((person) => (
                <span
                  key={person.id}
                  title={person.name}
                  className={bubble + " bg-emerald-100 text-emerald-800"}
                >
                  {initials(person.name)}
                </span>
              ))}
            </span>
            <span className="flex items-center gap-1 text-xs font-semibold whitespace-nowrap text-stone-700">
              <span className="size-2 rounded-full bg-emerald-500" />
              <span data-online-count>{online.length}</span> online
            </span>
          </span>
        }
      >
        <p className="border-b border-stone-200 px-3 py-2 text-xs font-bold">
          Online now ({online.length})
        </p>
        <ul data-online-list>
          {online.map((person) => (
            <li key={person.id} className={row}>
              <span className={bubble + " bg-emerald-100 text-emerald-800"}>
                {initials(person.name)}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate font-semibold">
                  {person.name}
                  {person.me && <span className="font-normal text-stone-500"> (you)</span>}
                </span>
                <span className="block text-[11px] text-stone-500">{roleLabel[person.role]}</span>
              </span>
              <span className="ml-auto size-2 shrink-0 rounded-full bg-emerald-500" />
            </li>
          ))}
        </ul>
        {away.length > 0 && (
          <>
            <p className="border-y border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-bold text-stone-600">
              Not online ({away.length})
            </p>
            <ul data-offline-list className="max-h-64 overflow-y-auto">
              {away.map((person) => (
                <li key={person.id} className={row}>
                  <span className={bubble + " bg-stone-200 text-stone-600"}>
                    {initials(person.name)}
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate font-semibold text-stone-700">
                      {person.name}
                    </span>
                    <span className="block text-[11px] text-stone-500">{lastSeen(person.ago)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Menu>
    </div>
  );
}
