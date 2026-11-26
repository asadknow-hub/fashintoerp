"use client";

import { useState, useTransition } from "react";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { formatMoney, variantLabel } from "@/lib/format";
import { createOrder, lookupCustomer } from "../actions";

export type OrderVariant = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  price: number;
  stock: number;
};

export type OrderProduct = {
  id: string;
  name: string;
  category: string | null;
  photo: string | null;
  colors: (string | null)[];
  sizes: (string | null)[];
  variants: OrderVariant[];
};

// One line of the order. Color and size are "undefined" until chosen; null
// means the product simply has no color (or size) to choose.
type Row = {
  key: number;
  productId: string;
  color: string | null | undefined;
  size: string | null | undefined;
  quantity: string;
  unitPrice: string;
};

const blank = (key: number): Row => ({
  key,
  productId: "",
  color: undefined,
  size: undefined,
  quantity: "1",
  unitPrice: "",
});

const sectionTitle = "text-[11px] font-bold tracking-wider text-stone-700 uppercase";
const left = (n: number) => (n > 0 ? `${n} left` : "out of stock");

/* ---------- Product search box ---------- */

function ProductPicker({
  products,
  value,
  onPick,
}: {
  products: OrderProduct[];
  value: string;
  onPick: (product: OrderProduct) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = products.find((product) => product.id === value);
  const words = query.trim().toLowerCase();
  const matches = products
    .filter((product) =>
      `${product.name} ${product.category ?? ""} ${product.variants.map((v) => v.sku).join(" ")}`
        .toLowerCase()
        .includes(words),
    )
    .slice(0, 40);

  const pick = (product: OrderProduct | undefined) => {
    if (!product) return;
    onPick(product);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-label="Product"
        aria-expanded={open}
        aria-controls="product-options"
        autoComplete="off"
        placeholder="Search product or SKU…"
        value={open ? query : (selected?.name ?? "")}
        onFocus={() => {
          setQuery("");
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (open) pick(matches[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className="input"
      />
      {open && (
        <ul
          id="product-options"
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full min-w-64 overflow-y-auto rounded-md border border-stone-300 bg-white shadow-lg"
        >
          {matches.length === 0 && (
            <li className="px-2.5 py-2 text-sm text-stone-500">No product matches.</li>
          )}
          {matches.map((product, index) => {
            const stock = product.variants.reduce((sum, v) => sum + v.stock, 0);
            return (
              <li
                key={product.id}
                role="option"
                aria-selected={index === active}
                // Keeps the box focused so the click lands before it closes.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(product);
                }}
                onMouseEnter={() => setActive(index)}
                className={
                  "flex cursor-pointer items-center gap-2 px-2 py-1 text-sm " +
                  (index === active ? "bg-stone-100" : "")
                }
              >
                <span className="size-8 shrink-0 overflow-hidden rounded border border-stone-200 bg-stone-100">
                  {product.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.photo} alt="" className="size-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{product.name}</span>
                  {product.category && (
                    <span className="text-stone-500"> · {product.category}</span>
                  )}
                </span>
                <span
                  className={
                    "shrink-0 text-xs tabular-nums " +
                    (stock > 0 ? "text-stone-500" : "font-semibold text-rose-700")
                  }
                >
                  {stock > 0 ? `${stock} in stock` : "Out of stock"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- The form ---------- */

export function OrderForm({
  products,
  currency,
  defaults,
}: {
  products: OrderProduct[];
  currency: string;
  defaults: { name: string; phone: string; conversationId: string; source: string };
}) {
  const [rows, setRows] = useState<Row[]>([blank(0)]);
  const [shippingFee, setShippingFee] = useState("");
  const [discount, setDiscount] = useState("");
  const [customer, setCustomer] = useState({
    name: defaults.name,
    phone: defaults.phone,
    address: "",
    city: "",
  });
  const [known, setKnown] = useState<string | null>(null);
  const [, startLookup] = useTransition();

  const productOf = (row: Row) => products.find((product) => product.id === row.productId);
  const variantOf = (row: Row, color = row.color, size = row.size) =>
    color === undefined || size === undefined
      ? undefined
      : productOf(row)?.variants.find((v) => v.color === color && v.size === size);
  const quantityOf = (row: Row) => {
    const n = Number(row.quantity.trim());
    return Number.isInteger(n) && n >= 1 ? n : null;
  };

  // Stock still free for this line: what's on the shelf minus what other
  // lines of this same order already take.
  const freeFor = (variant: OrderVariant, self: Row) =>
    variant.stock -
    rows
      .filter((other) => other.key !== self.key && variantOf(other)?.id === variant.id)
      .reduce((sum, other) => sum + (quantityOf(other) ?? 0), 0);

  const update = (key: number, change: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...change };
        // A newly chosen item brings its own price.
        const before = variantOf(row);
        const after = variantOf(next);
        if (after && after.id !== before?.id) next.unitPrice = String(after.price);
        if (!after && before) next.unitPrice = "";
        return next;
      }),
    );

  const lines = rows.map((row) => {
    const product = productOf(row);
    const variant = variantOf(row);
    const quantity = quantityOf(row);
    const free = variant ? freeFor(variant, row) : 0;
    const price = Number(row.unitPrice);
    const problem = !product
      ? null
      : !variant
        ? "choose"
        : free <= 0
          ? "out"
          : quantity === null
            ? "quantity"
            : quantity > free
              ? "short"
              : !row.unitPrice.trim() || !Number.isFinite(price) || price < 0
                ? "price"
                : null;
    // Other sizes and colors of the same product that can be sold right now.
    const others =
      product && variant && (problem === "out" || problem === "short")
        ? product.variants
            .filter((v) => v.id !== variant.id && freeFor(v, row) > 0)
            .sort(
              (a, b) =>
                Number(b.color === variant.color) - Number(a.color === variant.color) ||
                Number(b.size === variant.size) - Number(a.size === variant.size),
            )
            .slice(0, 6)
        : [];
    return { row, product, variant, quantity, free, price, problem, others };
  });

  const ready = lines.filter((line) => line.variant && !line.problem);
  const blocked = lines.some((line) => line.problem);
  const subtotal = ready.reduce((sum, line) => sum + line.quantity! * line.price, 0);
  const total = subtotal + (Number(shippingFee) || 0) - (Number(discount) || 0);
  const hold = blocked
    ? "Fix the item marked in red before creating the order."
    : ready.length === 0
      ? "Add at least one item."
      : !customer.name.trim()
        ? "Enter the customer's name."
        : null;

  const findCustomer = () =>
    startLookup(async () => {
      const found = await lookupCustomer(customer.phone);
      if (!found) return setKnown(null);
      setCustomer((current) => ({
        ...current,
        name: current.name.trim() || found.name,
        address: current.address.trim() || found.address,
        city: current.city.trim() || found.city,
      }));
      setKnown(
        `Returning customer: ${found.name} · ${found.orders} earlier ${found.orders === 1 ? "order" : "orders"}`,
      );
    });

  const columns =
    "grid grid-cols-2 gap-1.5 md:grid-cols-[minmax(9rem,1.5fr)_minmax(10rem,1.2fr)_minmax(9rem,1fr)_6.5rem_5.5rem_6rem_1.5rem] md:items-center";

  return (
    <ActionForm
      action={createOrder}
      submit="Create order"
      disabled={hold !== null}
      className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_23rem]"
      footerClassName="flex flex-wrap items-center gap-3 lg:col-start-2"
    >
      <input type="hidden" name="conversationId" value={defaults.conversationId} />
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(
          ready.map((line) => ({
            variantId: line.variant!.id,
            quantity: line.quantity,
            unitPrice: line.price,
          })),
        )}
      />

      <section className="card lg:col-start-1 lg:row-span-3 lg:row-start-1">
        <header className="flex min-h-9 items-center justify-between border-b border-stone-300 bg-stone-100 px-3 py-1">
          <h2 className={sectionTitle}>Items</h2>
          <span className="text-xs text-stone-500">
            {ready.length} {ready.length === 1 ? "item" : "items"} ·{" "}
            {ready.reduce((sum, line) => sum + line.quantity!, 0)} pieces
          </span>
        </header>

        {products.length === 0 ? (
          <p className="p-3 text-sm text-stone-600">
            You have no products yet. Add products in Inventory first.
          </p>
        ) : (
          <div className="p-3">
            <div className={columns + " mb-1 text-[11px] font-semibold text-stone-500 uppercase max-md:hidden"}>
              <span>Product</span>
              <span>Color</span>
              <span>Size</span>
              <span>Quantity</span>
              <span className="text-right">Price each</span>
              <span className="text-right">Total</span>
              <span />
            </div>

            <div className="space-y-2">
              {lines.map(({ row, product, variant, quantity, free, price, problem, others }) => {
                const red = problem === "out" || problem === "short";
                return (
                  <div
                    key={row.key}
                    data-line
                    className={
                      "rounded-md " + (red ? "bg-rose-50 p-1.5 ring-1 ring-rose-300" : "")
                    }
                  >
                    <div className={columns}>
                      <div className="max-md:col-span-2">
                        <ProductPicker
                          products={products}
                          value={row.productId}
                          onPick={(picked) =>
                            update(row.key, {
                              productId: picked.id,
                              // One color (or size) only: nothing to choose.
                              color: picked.colors.length === 1 ? picked.colors[0] : undefined,
                              size: picked.sizes.length === 1 ? picked.sizes[0] : undefined,
                            })
                          }
                        />
                      </div>

                      {(["color", "size"] as const).map((part) => {
                        const options = product ? (part === "color" ? product.colors : product.sizes) : [];
                        const chosen = row[part];
                        const single = options.length === 1;
                        return (
                          <select
                            key={part}
                            aria-label={part === "color" ? "Color" : "Size"}
                            disabled={!product || single}
                            value={chosen === undefined ? "" : String(options.indexOf(chosen))}
                            onChange={(event) =>
                              update(row.key, {
                                [part]:
                                  event.target.value === ""
                                    ? undefined
                                    : options[Number(event.target.value)],
                              })
                            }
                            className="input disabled:bg-stone-100 disabled:text-stone-500"
                          >
                            {!single && <option value="">{part === "color" ? "Color…" : "Size…"}</option>}
                            {options.map((option, index) => {
                              // Show how many are left for each choice.
                              const matching = product!.variants.filter((v) =>
                                part === "color"
                                  ? v.color === option && (row.size === undefined || v.size === row.size)
                                  : v.size === option && (row.color === undefined || v.color === row.color),
                              );
                              const count = matching.reduce(
                                (sum, v) => sum + Math.max(0, freeFor(v, row)),
                                0,
                              );
                              return (
                                <option key={String(option)} value={index}>
                                  {option === null
                                    ? part === "color"
                                      ? "One color"
                                      : "One size"
                                    : `${option} — ${matching.length ? left(count) : "not made"}`}
                                </option>
                              );
                            })}
                          </select>
                        );
                      })}

                      <div className="flex">
                        <button
                          type="button"
                          aria-label="One less"
                          onClick={() =>
                            update(row.key, { quantity: String(Math.max(1, (quantity ?? 1) - 1)) })
                          }
                          className="cursor-pointer rounded-l-md border border-r-0 border-stone-300 bg-white px-2 text-stone-600 hover:bg-stone-100"
                        >
                          −
                        </button>
                        <input
                          aria-label="Quantity"
                          inputMode="numeric"
                          value={row.quantity}
                          onChange={(event) => update(row.key, { quantity: event.target.value })}
                          className="input min-w-0 rounded-none px-1 text-center tabular-nums"
                        />
                        <button
                          type="button"
                          aria-label="One more"
                          onClick={() => update(row.key, { quantity: String((quantity ?? 0) + 1) })}
                          className="cursor-pointer rounded-r-md border border-l-0 border-stone-300 bg-white px-2 text-stone-600 hover:bg-stone-100"
                        >
                          +
                        </button>
                      </div>

                      <input
                        aria-label="Price each"
                        inputMode="decimal"
                        value={row.unitPrice}
                        onChange={(event) => update(row.key, { unitPrice: event.target.value })}
                        className="input text-right tabular-nums"
                      />

                      <span className="text-right text-sm font-semibold tabular-nums">
                        {variant && !problem ? formatMoney(quantity! * price, currency) : "—"}
                      </span>

                      <button
                        type="button"
                        aria-label="Remove item"
                        onClick={() =>
                          setRows((current) =>
                            current.length === 1
                              ? [blank(row.key + 1)]
                              : current.filter((r) => r.key !== row.key),
                          )
                        }
                        className="h-7 cursor-pointer rounded text-lg leading-none text-stone-500 hover:bg-stone-200"
                      >
                        ×
                      </button>
                    </div>

                    {/* What the stock says about this line. */}
                    {problem === "choose" && (
                      <p className="mt-1 text-xs text-stone-500">Choose the color and size.</p>
                    )}
                    {variant && problem === "out" && (
                      <p role="alert" className="mt-1.5 text-sm font-semibold text-rose-800">
                        Out of stock — can&apos;t be ordered.
                        <span className="font-normal">
                          {" "}
                          {product!.name} · {variantLabel(variant)} has none left.
                        </span>
                      </p>
                    )}
                    {variant && problem === "short" && (
                      <p role="alert" className="mt-1.5 text-sm font-semibold text-rose-800">
                        Only {free} left — can&apos;t order {quantity}.{" "}
                        <button
                          type="button"
                          onClick={() => update(row.key, { quantity: String(free) })}
                          className="cursor-pointer font-semibold underline"
                        >
                          Order {free} instead
                        </button>
                      </p>
                    )}
                    {red && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-stone-700">
                        {others.length ? (
                          <>
                            In stock instead:
                            {others.map((other) => (
                              <button
                                key={other.id}
                                type="button"
                                onClick={() =>
                                  update(row.key, { color: other.color, size: other.size })
                                }
                                className="cursor-pointer rounded border border-stone-300 bg-white px-1.5 py-0.5 font-medium hover:bg-stone-100"
                              >
                                {variantLabel(other)} · {freeFor(other, row)} left
                              </button>
                            ))}
                          </>
                        ) : (
                          problem === "out" && "Nothing else of this product is in stock either."
                        )}
                      </div>
                    )}
                    {problem === "quantity" && (
                      <p className="mt-1 text-xs text-rose-700">
                        Quantity must be a whole number, 1 or more.
                      </p>
                    )}
                    {problem === "price" && (
                      <p className="mt-1 text-xs text-rose-700">Enter a price.</p>
                    )}
                    {variant && !problem && (
                      <p className="mt-1 text-xs text-emerald-700">
                        In stock: {free} · {free - quantity!} left after this order
                        <span className="text-stone-400"> · {variant.sku}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="btn-secondary btn-sm mt-2"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  blank(Math.max(...current.map((row) => row.key)) + 1),
                ])
              }
            >
              + Add another item
            </button>
          </div>
        )}
      </section>

      <section className="card space-y-2 p-3 lg:col-start-2 lg:row-start-1">
        <h2 className={sectionTitle}>Customer</h2>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Phone" hint={known ?? undefined}>
            <input
              name="phone"
              inputMode="tel"
              value={customer.phone}
              onChange={(event) => setCustomer({ ...customer, phone: event.target.value })}
              onBlur={findCustomer}
              className="input"
            />
          </Field>
          <Field label="Name">
            <input
              name="name"
              required
              value={customer.name}
              onChange={(event) => setCustomer({ ...customer, name: event.target.value })}
              className="input"
            />
          </Field>
          <Field label="Address">
            <input
              name="address"
              value={customer.address}
              onChange={(event) => setCustomer({ ...customer, address: event.target.value })}
              className="input"
            />
          </Field>
          <Field label="City">
            <input
              name="city"
              value={customer.city}
              onChange={(event) => setCustomer({ ...customer, city: event.target.value })}
              className="input"
            />
          </Field>
        </div>
      </section>

      <section className="card space-y-2 p-3 lg:col-start-2 lg:row-start-2">
        <h2 className={sectionTitle}>Payment & delivery</h2>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Payment">
            <select name="payment" className="input" defaultValue="cod">
              <option value="cod">Cash on delivery</option>
              <option value="prepaid">Already paid</option>
            </select>
          </Field>
          <Field label="Came from">
            <input
              name="source"
              placeholder="Instagram, WhatsApp…"
              defaultValue={defaults.source}
              className="input"
            />
          </Field>
          <Field label="Delivery fee">
            <input
              name="shippingFee"
              inputMode="decimal"
              className="input"
              value={shippingFee}
              onChange={(event) => setShippingFee(event.target.value)}
            />
          </Field>
          <Field label="Discount">
            <input
              name="discount"
              inputMode="decimal"
              className="input"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Notes (optional)">
          <textarea name="notes" rows={2} className="input" />
        </Field>

        <dl className="space-y-0.5 border-t border-stone-300 pt-2 text-sm tabular-nums">
          <div className="flex justify-between text-stone-600">
            <dt>Items</dt>
            <dd>{formatMoney(subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between text-stone-600">
            <dt>Delivery</dt>
            <dd>{formatMoney(Number(shippingFee) || 0, currency)}</dd>
          </div>
          {(Number(discount) || 0) > 0 && (
            <div className="flex justify-between text-stone-600">
              <dt>Discount</dt>
              <dd>− {formatMoney(Number(discount), currency)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-stone-200 pt-1 font-bold">
            <dt>Total</dt>
            <dd data-order-total className="text-lg">
              {formatMoney(Math.max(total, 0), currency)}
            </dd>
          </div>
        </dl>
        {hold && (
          <p className={"text-xs " + (blocked ? "font-semibold text-rose-700" : "text-stone-500")}>
            {hold}
          </p>
        )}
      </section>
    </ActionForm>
  );
}
