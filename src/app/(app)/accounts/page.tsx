import { asc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { Empty, PageHeader, pageNumber, Pager } from "@/components/ui";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { formatMoney, likeTerm } from "@/lib/format";
import { dayWithin, namedPeriods, type PeriodKey, periodRange } from "@/lib/order-amount";
import { getPrefs } from "@/lib/settings";
import { type Line, TransactionButton } from "./transaction-form";

const PAGE_SIZE = 50;

const kinds = [
  { key: "", label: "All" },
  { key: "out", label: "Money out" },
  { key: "in", label: "Money in" },
  { key: "stock", label: "Stock purchases" },
] as const;

type Row = {
  source: "manual" | "stock";
  id: string;
  day: string;
  direction: "out" | "in";
  amount: string | null;
  purpose: string;
  by_name: string;
  by_user_id: string | null;
  product_id: string | null;
};

const dayText = (day: string) =>
  new Date(day + "T00:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// The accounts book: every transaction, newest first. Each line is a date,
// an amount, what it was for and who it was by. Money typed in here (rent,
// packaging, salaries…) sits together with the stock that was bought, which
// comes from the purchase batches by itself.
// Only Owners and the System Admin can see it.
export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const [me, params, { currency, timezone }] = await Promise.all([
    requireOwner(),
    searchParams,
    getPrefs(),
  ]);
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string).trim() : "");
  const kind = one("kind");
  const missing = kind === "missing";
  const period: PeriodKey = namedPeriods.some((p) => p.key === one("period"))
    ? (one("period") as PeriodKey)
    : "all";
  const q = one("q").slice(0, 80);
  const page = pageNumber(params.page);
  const range = periodRange(period, timezone);

  // Both kinds of line, as one list.
  const book = sql`(
    select 'manual'::text as source, t.id, t.day, t.direction, t.amount, t.purpose,
      t.by_name, t.by_user_id, null::uuid as product_id, t.created_at
    from transactions t
    union all
    select 'stock', p.id, (p.created_at at time zone ${timezone})::date, 'out', p.total_cost,
      'Stock: ' || pr.name
        || case when coalesce(p.note, '') <> '' then ' · ' || p.note else '' end
        || ' (' || p.units || ' pcs)',
      coalesce(u.name, '—'), p.created_by, p.product_id, p.created_at
    from stock_purchases p
    join products pr on pr.id = p.product_id
    left join users u on u.id = p.created_by
  ) book`;
  const where = sql`
    ${dayWithin(sql`book.day`, range, timezone)}
    and ${
      kind === "out"
        ? sql`book.direction = 'out'`
        : kind === "in"
          ? sql`book.direction = 'in'`
          : kind === "stock"
            ? sql`book.source = 'stock'`
            : missing
              ? sql`book.source = 'stock' and book.amount is null`
              : sql`true`
    }
    and ${q ? sql`book.purpose ilike ${likeTerm(q)}` : sql`true`}`;

  const [totalRows, rows, people, purposes, [unpriced]] = await Promise.all([
    db.execute<{ lines: number; out: string; in: string }>(sql`
      select count(*)::int as lines,
        coalesce(sum(book.amount) filter (where book.direction = 'out'), 0) as out,
        coalesce(sum(book.amount) filter (where book.direction = 'in'), 0) as in
      from ${book} where ${where}`),
    db.execute<Row>(sql`
      select book.source, book.id, book.day::text as day, book.direction, book.amount,
        book.purpose, book.by_name, book.by_user_id, book.product_id
      from ${book} where ${where}
      order by book.day desc, book.created_at desc
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name)),
    db.execute<{ purpose: string }>(sql`
      select purpose from transactions group by purpose order by count(*) desc, purpose limit 30`),
    db.execute<{ batches: number }>(sql`
      select count(*)::int as batches from stock_purchases where total_cost is null`),
  ]);
  const totals = totalRows[0];
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const formProps = {
    people,
    me: me.id,
    today,
    currency,
    purposes: purposes.map((row) => row.purpose),
  };

  const href = (change: { kind?: string; period?: string; page?: number }) => {
    const next = { kind, period, page: 1, ...change };
    const query = new URLSearchParams();
    if (next.kind) query.set("kind", next.kind);
    if (next.period !== "all") query.set("period", next.period);
    if (q) query.set("q", q);
    if (next.page > 1) query.set("page", String(next.page));
    const text = query.toString();
    return text ? `/accounts?${text}` : "/accounts";
  };
  const pill = (on: boolean) =>
    "rounded-full px-3 py-1.5 text-xs font-medium " +
    (on ? "bg-brand text-white" : "bg-stone-200/70 text-stone-700 hover:bg-stone-200");
  const net = Number(totals.in) - Number(totals.out);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-3">
        <PageHeader
          title="Accounts"
          subtitle="Every transaction: the date, the amount, what it was for and who it was by."
        />
        <TransactionButton {...formProps} />
      </div>

      <dl
        data-account-totals
        className="card mb-3 grid grid-cols-3 gap-px overflow-hidden bg-stone-200 text-sm"
      >
        {[
          ["Money out", `− ${formatMoney(totals.out, currency)}`, "text-rose-700"],
          ["Money in", `+ ${formatMoney(totals.in, currency)}`, "text-emerald-700"],
          [
            "In less out",
            `${net < 0 ? "− " : ""}${formatMoney(Math.abs(net), currency)}`,
            net < 0 ? "text-rose-700" : "",
          ],
        ].map(([label, text, tone]) => (
          <div key={label} className="bg-white px-3 py-2">
            <dt className="text-xs text-stone-500">{label}</dt>
            <dd className={"font-bold tabular-nums " + tone}>{text}</dd>
          </div>
        ))}
      </dl>

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-1" data-account-kinds>
          {kinds.map((option) => (
            <Link key={option.key} href={href({ kind: option.key })} className={pill(kind === option.key)}>
              {option.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" aria-label="Period">
          {namedPeriods.map((option) => (
            <Link
              key={option.key}
              href={href({ period: option.key })}
              className={pill(period === option.key)}
            >
              {option.label}
            </Link>
          ))}
        </div>
        <form className="ml-auto flex gap-2">
          {kind && <input type="hidden" name="kind" value={kind} />}
          {period !== "all" && <input type="hidden" name="period" value={period} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search the purpose"
            className="input w-52"
          />
          <button className="btn-secondary">Search</button>
        </form>
      </div>

      {unpriced.batches > 0 && !missing && (
        <p className="card mb-3 border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {unpriced.batches} stock {unpriced.batches === 1 ? "purchase has" : "purchases have"} no
          amount yet. Open the product and click the batch to type what you paid.{" "}
          <Link href="/accounts?kind=missing" className="font-semibold underline">
            Show them
          </Link>
        </p>
      )}
      {missing && (
        <p className="card mb-3 flex flex-wrap items-center gap-2 border-brand-100 bg-brand-50 px-3 py-2 text-sm">
          Showing only stock purchases with no amount yet.
          <Link href="/accounts" className="ml-auto font-semibold text-brand hover:underline">
            Show everything
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <Empty title={q || kind || period !== "all" ? "Nothing found" : "No transactions yet"}>
          {!q && !kind && period === "all" && "Use Add transaction to record money going out or coming in."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto" data-transactions>
          <table className="w-full text-sm tabular-nums">
            <thead className="border-b border-stone-200">
              <tr>
                <th className="th w-px whitespace-nowrap">Date</th>
                <th className="th w-px text-right whitespace-nowrap">Amount</th>
                <th className="th">Purpose</th>
                <th className="th w-px whitespace-nowrap">By</th>
                <th className="th w-px" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row) => (
                <tr key={row.source + row.id} data-source={row.source} className="hover:bg-stone-50">
                  <td className="td whitespace-nowrap text-stone-600">{dayText(row.day)}</td>
                  <td
                    className={
                      "td text-right font-bold whitespace-nowrap " +
                      (row.amount === null
                        ? ""
                        : row.direction === "in"
                          ? "text-emerald-700"
                          : "text-rose-700")
                    }
                  >
                    {row.amount === null ? (
                      <Link
                        href={`/inventory/${row.product_id}`}
                        className="font-semibold text-amber-700 hover:underline"
                      >
                        Add amount
                      </Link>
                    ) : (
                      `${row.direction === "in" ? "+" : "−"} ${formatMoney(row.amount, currency)}`
                    )}
                  </td>
                  <td className="td">
                    {row.source === "stock" ? (
                      <Link href={`/inventory/${row.product_id}`} className="hover:text-brand hover:underline">
                        {row.purpose}
                      </Link>
                    ) : (
                      row.purpose
                    )}
                  </td>
                  <td className="td font-semibold whitespace-nowrap">{row.by_name}</td>
                  <td className="td text-right">
                    {row.source === "manual" && (
                      <TransactionButton
                        {...formProps}
                        line={
                          {
                            id: row.id,
                            day: row.day,
                            direction: row.direction,
                            amount: row.amount ?? "0",
                            purpose: row.purpose,
                            byUserId: row.by_user_id,
                          } satisfies Line
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={totals.lines}
        href={(target) => href({ page: target })}
      />
    </>
  );
}
