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
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b-2 border-stone-900 pb-2">
      <div>
        <h1 className="text-xl leading-tight font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-stone-500">{subtitle}</p>}
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
  aside,
  children,
  flush = false,
  className,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={"card overflow-hidden " + (className ?? "")}>
      <header className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-b border-stone-300 bg-stone-100 px-3 py-1">
        <h2 className="text-[11px] font-bold tracking-wider text-stone-700 uppercase">{title}</h2>
        {aside}
      </header>
      <div className={flush ? "" : "p-3"}>{children}</div>
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
