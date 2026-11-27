import { Info } from "lucide-react";
import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl leading-tight font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p>}
      </div>
      {action && (
        <Link href={action.href} className="btn">
          {action.label}
        </Link>
      )}
    </div>
  );
}

// A titled box. Pages are built out of these so everything has a clear place.
export function Block({
  title,
  subtitle,
  icon,
  aside,
  children,
  flush = false,
  className,
}: {
  title: string;
  subtitle?: string;
  // A small picture shown before the title.
  icon?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={"card overflow-hidden " + (className ?? "")}>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2.5">
          {icon && <span className="text-brand [&>svg]:size-[18px]">{icon}</span>}
          <div>
            <h2 className="text-sm leading-tight font-bold text-stone-900">{title}</h2>
            {subtitle && <p className="text-[11px] text-stone-500">{subtitle}</p>}
          </div>
        </div>
        {aside}
      </header>
      <div className={flush ? "" : "px-4 pb-4"}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={"block " + (className ?? "")}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

const tones = {
  gray: "bg-stone-100 text-stone-700",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-rose-100 text-rose-800",
  blue: "bg-sky-100 text-sky-800",
  purple: "bg-violet-100 text-violet-800",
} as const;

export function Badge({
  tone = "gray",
  children,
}: {
  tone?: keyof typeof tones;
  children: React.ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap " +
        tones[tone]
      }
    >
      {children}
    </span>
  );
}

// The tag for an order's state. A delivered order that was later swapped
// for another one reads "Exchanged".
export function OrderBadge({
  status,
  exchanged = false,
}: {
  status: keyof typeof orderStatusLabel;
  exchanged?: boolean;
}) {
  return exchanged && status === "delivered" ? (
    <Badge tone="purple">Exchanged</Badge>
  ) : (
    <Badge tone={orderStatusTone[status]}>{orderStatusLabel[status]}</Badge>
  );
}

// A small "i" beside an order that was made as an exchange. Pointing at it
// says which order it replaces.
export function ExchangeInfo({ of }: { of: string }) {
  return (
    <span
      data-exchange-of={of}
      tabIndex={0}
      aria-label={`Exchange of ${of}`}
      className="group relative ml-1 inline-flex cursor-help align-middle text-violet-600 outline-none"
    >
      <Info className="size-3.5" strokeWidth={2.4} />
      <span className="pointer-events-none absolute top-1/2 left-full z-20 ml-1.5 hidden -translate-y-1/2 rounded-md bg-stone-900 px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-white shadow-lg group-hover:block group-focus:block">
        Exchange of {of}
      </span>
    </span>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card px-6 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && (
        <div className="mx-auto mt-1 max-w-md text-sm text-stone-500">
          {children}
        </div>
      )}
    </div>
  );
}

// How each step of an order is called on screen.
export const orderStatusLabel = {
  new: "New",
  confirmed: "In portal",
  packed: "Packed",
  shipped: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
} as const;

export const orderStatusTone = {
  new: "blue",
  confirmed: "blue",
  packed: "amber",
  shipped: "amber",
  delivered: "green",
  cancelled: "red",
  returned: "red",
} as const;

export function stockTone(stock: number, lowAt: number) {
  if (stock <= 0) return "red" as const;
  if (stock <= lowAt) return "amber" as const;
  return "green" as const;
}

// Reads the page number from the address, never below 1.
export function pageNumber(value: string | string[] | undefined) {
  const n = Number(typeof value === "string" ? value : "1");
  return Number.isInteger(n) && n >= 1 && n < 100000 ? n : 1;
}

// "Showing 1–50 of 240" with Previous and Next. Nothing is ever cut off:
// whatever isn't on this page is on another one.
export function Pager({
  page,
  pageSize,
  total,
  href,
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
}) {
  if (total <= pageSize && page === 1) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const link = "btn-secondary btn-sm";
  const off = link + " pointer-events-none opacity-40";
  return (
    <nav
      aria-label="Pages"
      className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600"
    >
      <span>
        Showing {first}–{last} of {total}
      </span>
      <span className="flex items-center gap-1.5">
        <Link href={href(page - 1)} aria-disabled={page <= 1} className={page <= 1 ? off : link}>
          ← Previous
        </Link>
        <span className="tabular-nums">
          Page {page} of {pages}
        </span>
        <Link
          href={href(page + 1)}
          aria-disabled={page >= pages}
          className={page >= pages ? off : link}
        >
          Next →
        </Link>
      </span>
    </nav>
  );
}
