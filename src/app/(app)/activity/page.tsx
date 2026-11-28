import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import Link from "next/link";
import { Empty, PageHeader, pageNumber, Pager } from "@/components/ui";
import { db } from "@/db";
import { auditLog, errorLog, orders } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { formatDateTime, likeTerm } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

const PAGE_SIZE = 100;

const areas = [
  { key: "", label: "Everything" },
  { key: "orders", label: "Orders" },
  { key: "stock", label: "Stock" },
  { key: "products", label: "Products" },
  { key: "staff", label: "Staff" },
  { key: "settings", label: "Settings" },
  { key: "account", label: "Sign-ins & passwords" },
];

// Who did what, and when: every change made in the system, newest first.
// Only Owners and the System Admin can see it.
export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const [me, params, { timezone }] = await Promise.all([requireOwner(), searchParams, getPrefs()]);
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string).trim() : "");
  const area = areas.some((option) => option.key === one("area")) ? one("area") : "";
  const who = one("who");
  const q = one("q").slice(0, 80);
  const page = pageNumber(params.page);

  const where = and(
    area ? eq(auditLog.area, area) : undefined,
    who ? eq(auditLog.userName, who) : undefined,
    q ? or(ilike(auditLog.subject, likeTerm(q)), ilike(auditLog.summary, likeTerm(q))) : undefined,
  );
  const [[{ total }], rows, people] = await Promise.all([
    db.select({ total: count() }).from(auditLog).where(where),
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .selectDistinct({ name: auditLog.userName })
      .from(auditLog)
      .orderBy(sql`1`),
  ]);

  // Orders that were deleted since can't be opened any more.
  const orderIds = [...new Set(rows.flatMap((row) => (row.orderId ? [row.orderId] : [])))];
  const stillThere = new Set(
    orderIds.length
      ? (await db.select({ id: orders.id }).from(orders).where(inArray(orders.id, orderIds))).map(
          (order) => order.id,
        )
      : [],
  );

  // For the System Admin: what went wrong on the server lately.
  const problemsView = me.role === "admin" && params.view === "problems";
  const [[{ lately }], problems] =
    me.role === "admin"
      ? await Promise.all([
          db
            .select({ lately: count() })
            .from(errorLog)
            .where(sql`${errorLog.at} > now() - interval '24 hours'`),
          problemsView
            ? db.select().from(errorLog).orderBy(desc(errorLog.at)).limit(200)
            : Promise.resolve([]),
        ])
      : [[{ lately: 0 }], []];

  const href = (changes: { area?: string; who?: string; page?: number }) => {
    const query = new URLSearchParams();
    const nextArea = changes.area ?? area;
    const nextWho = changes.who ?? who;
    if (nextArea) query.set("area", nextArea);
    if (nextWho) query.set("who", nextWho);
    if (q) query.set("q", q);
    if (changes.page && changes.page > 1) query.set("page", String(changes.page));
    const text = query.toString();
    return text ? `/activity?${text}` : "/activity";
  };
  const pill = (on: boolean) =>
    "rounded-full px-3 py-1.5 text-xs font-medium " +
    (on ? "bg-brand text-white" : "bg-stone-200/70 text-stone-700 hover:bg-stone-200");

  return (
    <>
      <PageHeader
        title="Activity Log"
        subtitle="Who did what, and when. Every change is recorded here and can't be edited."
      />

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1" data-activity-areas>
          {areas.map((option) => (
            <Link
              key={option.key}
              href={href({ area: option.key })}
              className={pill(!problemsView && area === option.key)}
            >
              {option.label}
            </Link>
          ))}
          {me.role === "admin" && (
            <Link href="/activity?view=problems" data-problems-link className={pill(problemsView)}>
              Problems{lately > 0 ? ` (${lately} today)` : ""}
            </Link>
          )}
        </div>
        <form className="ml-auto flex flex-wrap gap-2">
          {area && <input type="hidden" name="area" value={area} />}
          <select name="who" defaultValue={who} aria-label="Person" className="input w-44">
            <option value="">Everyone</option>
            {people.map((person) => (
              <option key={person.name} value={person.name}>
                {person.name}
              </option>
            ))}
          </select>
          <input
            name="q"
            defaultValue={q}
            placeholder="FO number, product, word…"
            className="input w-56"
          />
          <button className="btn-secondary">Show</button>
        </form>
      </div>

      {problemsView ? (
        problems.length === 0 ? (
          <Empty title="No problems recorded">
            When a page fails to load or a save crashes, it is listed here.
          </Empty>
        ) : (
          <div className="card overflow-x-auto" data-problems>
            <table className="w-full text-[13px] leading-snug">
              <thead className="border-b border-stone-200">
                <tr>
                  <th className="th w-px whitespace-nowrap">When</th>
                  <th className="th w-px whitespace-nowrap">Where</th>
                  <th className="th">What went wrong</th>
                  <th className="th w-px whitespace-nowrap">Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {problems.map((problem) => (
                  <tr key={problem.id} className="align-top">
                    <td className="td whitespace-nowrap text-stone-600">
                      {formatDateTime(problem.at, timezone)}
                    </td>
                    <td className="td font-mono text-xs break-all">{problem.path}</td>
                    <td className="td break-words">{problem.message}</td>
                    <td className="td font-mono text-xs whitespace-nowrap text-stone-500">
                      {problem.digest ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : rows.length === 0 ? (
        <Empty title={q || area || who ? "Nothing found" : "Nothing has been recorded yet"}>
          {!q && !area && !who && "Changes made from now on will show up here."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto" data-activity>
          <table className="w-full text-[13px] leading-snug">
            <thead className="border-b border-stone-200">
              <tr>
                <th className="th w-px whitespace-nowrap">When</th>
                <th className="th w-px whitespace-nowrap">Who</th>
                <th className="th w-px whitespace-nowrap">On</th>
                <th className="th">What</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row) => (
                <tr key={row.id} className="align-top hover:bg-stone-50">
                  <td className="td whitespace-nowrap text-stone-600">
                    {formatDateTime(row.at, timezone)}
                  </td>
                  <td className="td font-semibold whitespace-nowrap">{row.userName}</td>
                  <td className="td font-semibold whitespace-nowrap">
                    {row.orderId && stillThere.has(row.orderId) ? (
                      <Link href={`/orders/${row.orderId}`} className="text-brand hover:underline">
                        {row.subject}
                      </Link>
                    ) : row.productId ? (
                      <Link href={`/inventory/${row.productId}`} className="text-brand hover:underline">
                        {row.subject}
                      </Link>
                    ) : (
                      row.subject
                    )}
                  </td>
                  <td className="td">{row.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!problemsView && (
        <Pager page={page} pageSize={PAGE_SIZE} total={total} href={(target) => href({ page: target })} />
      )}
    </>
  );
}
