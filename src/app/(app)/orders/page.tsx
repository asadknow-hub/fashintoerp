import { and, asc, count, desc, eq, exists, ilike, inArray, or, type SQL, sql } from "drizzle-orm";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, List } from "lucide-react";
import Link from "next/link";
import { ClickableRow } from "@/components/clickable-row";
import { CopyButton } from "@/components/copy-button";
import {
  Empty,
  ExchangeInfo,
  OrderBadge,
  PageHeader,
  pageNumber,
  Pager,
} from "@/components/ui";
import { db } from "@/db";
import {
  customers,
  deliveryCompanies,
  orderItems,
  orders,
  products,
  variants,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  isUuid,
  likeTerm,
  orderName,
  phoneTerms,
} from "@/lib/format";
import { cityCode } from "@/lib/locations";
import { getPrefs } from "@/lib/settings";
import { OrderActions, type OrderCard } from "./order-actions";
import { OrderBoard } from "./order-board";
import { OrderSearch } from "./order-search";

type Status = (typeof orders.status.enumValues)[number];

const PAGE_SIZE = 50;
const BOARD_SIZE = 400;

const filters: { key: string; label: string; statuses?: Status[] }[] = [
  { key: "", label: "All" },
  {
    key: "open",
    label: "To send out",
    statuses: ["new", "confirmed", "packed"],
  },
  { key: "shipped", label: "Dispatched", statuses: ["shipped"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
  { key: "returned", label: "Returns", statuses: ["returned"] },
];

// The columns the list can be sorted by, with what each sorts on and the
// direction the first click gives: newest and biggest first, names from A.
type Direction = "asc" | "desc";
const sorts = {
  date: { first: "desc", by: sql`${orders.createdAt}` },
  // FO9 before FO10: by the number in it, not letter by letter.
  order: {
    first: "asc",
    by: sql`coalesce(nullif(regexp_replace(coalesce(${orders.trackingNumber}, ''), '[^0-9]', '', 'g'), '')::numeric, ${orders.number})`,
  },
  customer: { first: "asc", by: sql`lower(${customers.name})` },
  items: {
    first: "desc",
    by: sql`(select coalesce(sum(i.quantity), 0) from order_items i where i.order_id = ${orders.id})`,
  },
  instruction: { first: "asc", by: sql`lower(nullif(trim(${orders.instruction}), ''))` },
  description: {
    first: "asc",
    by: sql`(
      select string_agg(lower(p.name) || ' ' || coalesce(v.size, '') || ' ' || coalesce(v.color, ''), ', ' order by p.name, v.created_at)
      from order_items i
      join variants v on v.id = i.variant_id
      join products p on p.id = v.product_id
      where i.order_id = ${orders.id}
    )`,
  },
  // By city, then by area inside it.
  address: {
    first: "asc",
    by: sql`lower(nullif(trim(concat_ws(' ', ${orders.city}, ${orders.area}, ${orders.street})), ''))`,
  },
  cod: {
    first: "desc",
    by: sql`case when ${orders.payment} = 'cod' or ${orders.exchangeOfId} is not null then ${orders.codAmount} else 0 end`,
  },
  // How far along the order is.
  actions: {
    first: "asc",
    by: sql`case ${orders.status} when 'new' then 0 when 'confirmed' then 1 when 'packed' then 1 when 'shipped' then 2 when 'delivered' then 3 when 'returned' then 4 else 5 end`,
  },
} satisfies Record<string, { first: Direction; by: SQL }>;
type SortKey = keyof typeof sorts;

export default async function OrdersPage({
  searchParams,
}: PageProps<"/orders">) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const status = typeof params.status === "string" ? params.status : "";
  const filter = filters.find((f) => f.key === status) ?? filters[0];
  // The same orders as cards in columns, one column per step.
  const board = params.view === "board";
  const { currency, timezone } = await getPrefs();
  const number = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;

  // Opened from a product page: only the orders that contain that product.
  const productId =
    typeof params.product === "string" && isUuid(params.product) ? params.product : null;
  const [only] = productId
    ? await db.select({ name: products.name }).from(products).where(eq(products.id, productId))
    : [];

  const page = pageNumber(params.page);
  const sort: SortKey =
    typeof params.sort === "string" && Object.hasOwn(sorts, params.sort)
      ? (params.sort as SortKey)
      : "date";
  const dir: Direction =
    params.dir === "asc" || params.dir === "desc" ? params.dir : sorts[sort].first;
  const where = and(
    board
      ? // Everything still on its way, plus what was delivered this week.
        or(
          inArray(orders.status, ["new", "confirmed", "packed", "shipped"]),
          and(
            eq(orders.status, "delivered"),
            sql`coalesce(${orders.deliveredAt}, ${orders.createdAt}) >= now() - interval '7 days'`,
          ),
        )
      : filter.statuses
        ? inArray(orders.status, filter.statuses)
        : undefined,
    only
      ? exists(
          db
            .select({ one: sql`1` })
            .from(orderItems)
            .innerJoin(variants, eq(variants.id, orderItems.variantId))
            .where(and(eq(orderItems.orderId, orders.id), eq(variants.productId, productId!))),
        )
      : undefined,
    q
      ? or(
          ilike(customers.name, likeTerm(q)),
          ilike(customers.phone, likeTerm(q)),
          ilike(orders.trackingNumber, likeTerm(q)),
          // A number typed with spaces, a leading 0 or the country code.
          ...phoneTerms(q).flatMap((term) => [
            ilike(customers.phone, term),
            ilike(orders.phone2, term),
          ]),
          number !== null && number < 2 ** 31
            ? eq(orders.number, number)
            : undefined,
        )
      : undefined,
  );
  const [[{ total }], rows, companies] = await Promise.all([
    db
      .select({ total: count() })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where),
    db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        payment: orders.payment,
        codAmount: orders.codAmount,
        total: orders.total,
        refundSentAt: orders.refundSentAt,
        deliveredOn: orders.deliveredAt,
        ref: orders.trackingNumber,
        instruction: orders.instruction,
        notes: orders.notes,
        city: orders.city,
        area: orders.area,
        street: orders.street,
        shippingAddress: orders.shippingAddress,
        phone2: orders.phone2,
        companyId: orders.deliveryCompanyId,
        company: deliveryCompanies.name,
        portalAt: orders.portalAt,
        dispatchedAt: orders.dispatchedAt,
        deliveredAt: orders.deliveredAt,
        deliveryCharge: orders.deliveryCharge,
        returnFee: orders.returnFee,
        exchangeOfId: orders.exchangeOfId,
        // For an exchange: the name of the order it replaces.
        exchangeOf: sql<string | null>`(
          select coalesce(x.tracking_number, '#' || x.number) from orders x
          where x.id = ${orders.exchangeOfId}
        )`,
        // The order (not a cancelled one) that was made to replace this one.
        exchangedWith: sql<string | null>`(
          select coalesce(x.tracking_number, '#' || x.number) from orders x
          where x.exchange_of_id = ${orders.id} and x.status <> 'cancelled' limit 1
        )`,
        refundBase: orders.refundBase,
        cancelFee: orders.cancelFee,
        createdAt: orders.createdAt,
        customer: customers.name,
        phone: customers.phone,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(deliveryCompanies, eq(deliveryCompanies.id, orders.deliveryCompanyId))
      .where(where)
      .orderBy(
        // The board has room for a few hundred cards. If there are ever
        // more, the ones kept are the orders still on their way, oldest
        // first: an old order waiting must never drop out of sight.
        ...(board
          ? [sql`(${orders.status} = 'delivered')`, asc(orders.createdAt)]
          : []),
        ...(board || sort === "date"
          ? []
          : [
              // Orders with nothing in that column go to the bottom either way.
              dir === "asc"
                ? sql`${sorts[sort].by} asc nulls last`
                : sql`${sorts[sort].by} desc nulls last`,
            ]),
        !board && sort === "date" && dir === "asc" ? asc(orders.createdAt) : desc(orders.createdAt),
        asc(orders.id),
      )
      .limit(board ? BOARD_SIZE : PAGE_SIZE)
      .offset(board ? 0 : (page - 1) * PAGE_SIZE),
    db
      .select({
        id: deliveryCompanies.id,
        name: deliveryCompanies.name,
        rate: deliveryCompanies.rate,
        openedFee: deliveryCompanies.openedFee,
        active: deliveryCompanies.active,
      })
      .from(deliveryCompanies)
      .orderBy(asc(deliveryCompanies.name)),
  ]);

  // What is in each order on this page: "1 M Black, 2 XL Grey" per product.
  const lines = rows.length
    ? await db
        .select({
          orderId: orderItems.orderId,
          quantity: orderItems.quantity,
          product: products.name,
          size: variants.size,
          color: variants.color,
        })
        .from(orderItems)
        .innerJoin(variants, eq(variants.id, orderItems.variantId))
        .innerJoin(products, eq(products.id, variants.productId))
        .where(
          inArray(
            orderItems.orderId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(asc(products.name), asc(variants.createdAt))
    : [];
  const contents = new Map<string, { pieces: number; products: Map<string, string[]> }>();
  for (const line of lines) {
    const entry = contents.get(line.orderId) ?? { pieces: 0, products: new Map() };
    entry.pieces += line.quantity;
    const what = [line.quantity, line.size, line.color].filter(Boolean).join(" ");
    entry.products.set(line.product, [...(entry.products.get(line.product) ?? []), what]);
    contents.set(line.orderId, entry);
  }
  const when = (date: Date | null) => (date ? formatDateTime(date, timezone) : null);

  // Each order written out for the Actions pop-up and the board.
  const stageOf = (status: Status): OrderCard["stage"] =>
    status === "new"
      ? "new"
      : status === "confirmed" || status === "packed"
        ? "portal"
        : status === "shipped"
          ? "dispatched"
          : status === "delivered"
            ? "delivered"
            : "closed";
  const said = (orderId: string) =>
    [...(contents.get(orderId)?.products ?? [])]
      .map(([product, what]) => `${product}: ${what.join(", ")}`)
      .join(" · ");
  // What the customer paid for the goods: on an exchange, what they paid on
  // the order it replaces; otherwise the COD, or the value if paid beforehand.
  const paidOf = (row: (typeof rows)[number]) =>
    Number(
      row.refundBase ??
        (row.payment === "cod" || row.exchangeOfId ? row.codAmount : row.total),
    );
  const card = (row: (typeof rows)[number]): OrderCard => ({
    id: row.id,
    number: row.number,
    name: orderName(row.ref, row.number),
    customer: row.customer,
    phone: row.phone,
    stage: stageOf(row.status),
    status: row.status,
    exchangedWith: row.exchangedWith,
    place: [row.city, row.area].filter(Boolean).join(" · "),
    contents: said(row.id),
    cod:
      row.payment === "cod" || row.exchangeOfId ? formatMoney(row.codAmount, currency) : "Paid",
    paid: paidOf(row),
    exchangeOf: row.exchangeOf,
    company: row.company,
    companyId: row.companyId,
    portalAt: when(row.portalAt),
    dispatchedAt: when(row.dispatchedAt),
    deliveredAt: when(row.deliveredAt),
    deliveryCharge: row.deliveryCharge === null ? null : Number(row.deliveryCharge),
  });
  // The company an order went with stays choosable for it even after it
  // was taken off the list in Settings.
  const companiesFor = (used: (string | null)[]) =>
    companies
      .filter((company) => company.active || used.includes(company.id))
      .map((company) => ({
        id: company.id,
        name: company.name,
        rate: Number(company.rate),
        openedFee: Number(company.openedFee),
      }));

  // The address of the list with something changed: the filter, the sorting
  // or the page. Everything not named stays as it is.
  const listHref = (change: {
    status?: string;
    q?: string;
    sort?: SortKey;
    dir?: Direction;
    page?: number;
  }) => {
    const next = { status: filter.key, q, sort, dir, page: 1, ...change };
    const query = new URLSearchParams();
    if (next.status) query.set("status", next.status);
    if (only) query.set("product", productId!);
    if (next.q) query.set("q", next.q);
    if (next.sort !== "date" || next.dir !== "desc") {
      query.set("sort", next.sort);
      query.set("dir", next.dir);
    }
    if (next.page > 1) query.set("page", String(next.page));
    const text = query.toString();
    return text ? `/orders?${text}` : "/orders";
  };
  const pageHref = (target: number) => listHref({ page: target });

  // Tight cells: this list is worked from all day.
  // Light lines between the columns, like a spreadsheet.
  const line = " border-r border-stone-200 last:border-r-0";
  const head =
    "px-2.5 py-2 text-left text-xs font-semibold whitespace-nowrap text-stone-600 bg-stone-50" + line;
  const cell = "px-2.5 py-2" + line;
  // A column heading that sorts the list by that column; again to turn it round.
  const heading = (key: SortKey, label: string, className = "") => {
    const on = sort === key;
    const Arrow = !on ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th
        className={head + className}
        aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : undefined}
      >
        <Link
          href={listHref({
            sort: key,
            dir: on ? (dir === "asc" ? "desc" : "asc") : sorts[key].first,
          })}
          data-sort={key}
          title={`Sort by ${label.toLowerCase()}`}
          className={
            "group inline-flex items-center gap-1 hover:text-brand " + (on ? "text-brand" : "")
          }
        >
          {label}
          <Arrow
            className={"size-3 " + (on ? "" : "text-stone-400 opacity-60 group-hover:opacity-100")}
          />
        </Link>
      </th>
    );
  };

  return (
    <>
      <PageHeader
        title={board ? "Order Board" : filter.key === "returned" ? "Order Returns" : "Orders"}
        subtitle={
          board
            ? "Drag an order to its next step, or use its Actions button."
            : filter.key === "returned"
              ? "Orders that came back. Their items were put back in stock."
              : undefined
        }
        action={{ href: "/orders/new", label: "Create Order" }}
      />

      {only && (
        <p
          data-product-filter
          className="card mb-3 flex flex-wrap items-center gap-2 border-brand-100 bg-brand-50 px-3 py-2 text-sm"
        >
          Showing only orders that contain <b>{only.name}</b>.
          <Link href={`/inventory/${productId}`} className="font-semibold text-brand hover:underline">
            Back to the product
          </Link>
          <Link href="/orders" className="ml-auto font-semibold text-brand hover:underline">
            Show all orders
          </Link>
        </p>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div
          data-view-toggle
          className="flex overflow-hidden rounded-lg border border-stone-200 bg-white text-xs font-semibold"
        >
          {[
            { on: !board, href: "/orders", label: "List", icon: List },
            { on: board, href: "/orders?view=board", label: "Board", icon: Columns3 },
          ].map((view) => (
            <Link
              key={view.label}
              href={view.href}
              aria-current={view.on ? "true" : undefined}
              className={
                "flex items-center gap-1.5 px-3 py-1.5 " +
                (view.on ? "bg-brand text-white" : "text-stone-700 hover:bg-stone-100")
              }
            >
              <view.icon className="size-3.5" /> {view.label}
            </Link>
          ))}
        </div>
        <div className={"flex flex-wrap gap-1" + (board ? " hidden" : "")}>
          {filters.map((f) => (
            <Link
              key={f.key}
              href={listHref({ status: f.key, q: "" })}
              className={
                "rounded-full px-3 py-1.5 text-xs font-medium " +
                (filter.key === f.key
                  ? "bg-brand text-white"
                  : "bg-stone-200/70 text-stone-700 hover:bg-stone-200")
              }
            >
              {f.label}
            </Link>
          ))}
        </div>
        <OrderSearch q={q} />
      </div>

      {board ? (
        <OrderBoard
          currency={currency}
          hidden={Math.max(0, total - rows.length)}
          // Newest first inside each column, as on the list.
          cards={[...rows]
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map(card)}
          companies={companiesFor(rows.map((row) => row.companyId))}
        />
      ) : rows.length === 0 ? (
        <Empty
          title={
            filter.key === "returned" && !q
              ? "No returns"
              : q || filter.key
                ? "Nothing found"
                : "No orders yet"
          }
        >
          {filter.key === "returned" &&
            !q &&
            "To record a return, open the order and set its status to Returned."}
          {!q && !filter.key && "Orders you create will show up here."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto" data-orders>
          <table className="w-full text-[13px] leading-snug">
            <thead className="border-b border-stone-200">
              <tr>
                {heading("date", "Date", " w-px")}
                {heading("order", "Order", " w-px")}
                {heading("customer", "Customer")}
                {heading("items", "Items", " w-px text-center")}
                {heading("instruction", "Instruction")}
                {heading("description", "Description")}
                {heading("address", "Address")}
                {heading("cod", "COD", " w-px text-right")}
                {heading("actions", "Actions", " w-px")}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {rows.map((row) => {
                const inside = contents.get(row.id);
                const shut = row.status === "cancelled" || row.status === "returned";
                return (
                  <ClickableRow
                    key={row.id}
                    href={`/orders/${row.id}`}
                    data-order={row.number}
                    className="align-top hover:bg-brand-50/60"
                  >
                    <td className={cell + " whitespace-nowrap text-stone-600"}>
                      {formatDate(row.createdAt, timezone)}
                    </td>
                    <td className={cell + " whitespace-nowrap"}>
                      <Link
                        href={`/orders/${row.id}`}
                        className="font-bold tabular-nums hover:text-brand hover:underline"
                      >
                        {orderName(row.ref, row.number)}
                      </Link>
                      {row.ref && <CopyButton text={row.ref} label="order number" />}
                      <span className="mt-0.5 flex items-center">
                        <OrderBadge status={row.status} exchanged={row.exchangedWith !== null} />
                        {row.exchangeOf && <ExchangeInfo of={row.exchangeOf} />}
                      </span>
                    </td>
                    <td className={cell}>
                      <span className="block whitespace-nowrap">
                        <span className="font-semibold">{row.customer}</span>
                        <CopyButton text={row.customer} label="name" />
                      </span>
                      {row.phone && (
                        <span className="block text-xs whitespace-nowrap text-stone-500">
                          {row.phone}
                          <CopyButton text={row.phone} label="mobile" />
                        </span>
                      )}
                      {row.phone2 && (
                        <span className="block text-xs whitespace-nowrap text-stone-500">
                          {row.phone2}
                          <CopyButton text={row.phone2} label="second mobile" />
                        </span>
                      )}
                    </td>
                    <td className={cell + " text-center font-bold tabular-nums"}>
                      {inside?.pieces ?? 0}
                    </td>
                    <td className={cell + " max-w-44 text-stone-700"}>
                      {row.instruction ? (
                        <>
                          {row.instruction}
                          <CopyButton text={row.instruction} label="instruction" />
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={cell + " max-w-56"} data-order-contents>
                      {inside
                        ? [...inside.products].map(([product, what], index, all) => (
                            <span key={product} className="block">
                              <span className="block text-[11px] text-stone-500">{product}</span>
                              <span className="text-xs font-semibold">{what.join(", ")}</span>
                              {/* One button copies everything in the order: just
                                  the pieces, with product names when there are
                                  several products. */}
                              {index === all.length - 1 && (
                                <CopyButton
                                  label="description"
                                  text={
                                    all.length === 1
                                      ? what.join(", ")
                                      : all.map(([name, items]) => `${name}: ${items.join(", ")}`).join("; ")
                                  }
                                />
                              )}
                            </span>
                          ))
                        : "—"}
                      {row.notes && (
                        <span className="mt-0.5 block text-[11px] text-stone-500 italic">{row.notes}</span>
                      )}
                    </td>
                    <td className={cell + " max-w-52 text-xs"} data-order-address>
                      {row.city || row.area || row.street ? (
                        <>
                          {/* Area with the city's code beside it, to keep the row short. */}
                          {(row.area || row.city) && (
                            <span className="block font-semibold" title={row.city ?? undefined}>
                              {[row.area, cityCode(row.city)].filter(Boolean).join(", ")}
                            </span>
                          )}
                          {row.street && (
                            <span className="block text-stone-600">
                              {row.street}
                              <CopyButton text={row.street} label="street address" />
                            </span>
                          )}
                        </>
                      ) : (
                        (row.shippingAddress ?? "—")
                      )}
                    </td>
                    <td className={cell + " text-right font-bold whitespace-nowrap tabular-nums"}>
                      {row.payment === "cod" || row.exchangeOfId
                        ? formatMoney(row.codAmount, currency)
                        : "Paid"}
                    </td>
                    <td className={cell}>
                      {shut ? (
                        <Link href={`/orders/${row.id}`} className="btn-secondary btn-sm">
                          Open
                        </Link>
                      ) : (
                        <OrderActions
                          currency={currency}
                          companies={companiesFor([row.companyId])}
                          order={card(row)}
                        />
                      )}
                      {row.status === "returned" && row.deliveredOn && (
                        <span
                          className={
                            "mt-1 block text-xs whitespace-nowrap " +
                            (row.refundSentAt ? "text-stone-500" : "font-semibold text-amber-700")
                          }
                        >
                          Refund{" "}
                          {formatMoney(
                            Math.max(paidOf(row) - Number(row.returnFee ?? 0), 0),
                            currency,
                          )}
                          {row.refundSentAt ? " sent" : " to send"}
                        </span>
                      )}
                      {row.status === "cancelled" && row.cancelFee !== null && (
                        <span className="mt-1 block text-xs whitespace-nowrap text-stone-500">
                          Opened: {formatMoney(row.cancelFee, currency)} charged
                        </span>
                      )}
                    </td>
                  </ClickableRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!board && <Pager page={page} pageSize={PAGE_SIZE} total={total} href={pageHref} />}
    </>
  );
}
