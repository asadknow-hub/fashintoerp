"use client";

import {
  ArrowLeftRight,
  Ban,
  Info,
  ListChecks,
  PackageCheck,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { pieceCost } from "@/lib/offer";
import { deleteOrder, editOrder, editOrderItems, markRefund, settleItem } from "../actions";
import { type ActionView, type Company, type OrderCard, StepsModal } from "../order-actions";

// The card at the top right of an order: what can be done with it now.
// An order on its way can be moved along or cancelled; a delivered one can
// come back (return) or be swapped (exchange).
export function OutcomeActions({
  order,
  companies,
  currency,
}: {
  order: OrderCard;
  companies: Company[];
  currency: string;
}) {
  const [view, setView] = useState<ActionView | null>(null);
  const delivered = order.stage === "delivered";
  if (order.stage === "closed") return null;
  // Once exchanged, what comes next happens on the order that replaced it.
  const swapped = delivered ? order.exchangedWith : null;

  return (
    <section
      data-outcome-actions
      className="card border-brand-100 bg-gradient-to-br from-white to-brand-50 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand">
          {delivered ? <ArrowLeftRight className="size-5" /> : <ListChecks className="size-5" />}
        </span>
        <div>
          <h2 className="text-base font-bold">
            {delivered ? "Post-Delivery Actions" : "Order Actions"}
          </h2>
          <p className="text-xs text-stone-600">
            {delivered
              ? "Start a return or exchange for this delivered order."
              : "Move this order to its next step, or cancel it."}
          </p>
        </div>
      </div>
      <div className={"mt-3 grid grid-cols-2 gap-2" + (swapped ? " hidden" : "")}>
        {delivered ? (
          <>
            <button type="button" onClick={() => setView("return")} className="btn justify-center">
              <Undo2 className="size-4" /> Create Return
            </button>
            <Link
              href={`/orders/new?exchange=${order.id}`}
              className="btn-secondary justify-center border-brand-200 text-brand"
            >
              <Repeat className="size-4" /> Create Exchange
            </Link>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setView("steps")} className="btn justify-center">
              <ListChecks className="size-4" /> Update Steps
            </button>
            <button
              type="button"
              onClick={() => setView("cancel")}
              className="btn-secondary justify-center text-rose-700"
            >
              <Ban className="size-4" /> Cancel Order
            </button>
          </>
        )}
      </div>
      <p className="mt-3 flex items-start gap-2 text-xs text-stone-600">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {swapped
          ? `This order was exchanged with ${swapped}. A return or another exchange is made on that order, since the customer now has its pieces.`
          : delivered
            ? "Clicking one of these starts the next workflow step in the roadmap (Return / Exchange)."
            : "A return or an exchange can be started once the order is delivered."}
      </p>
      {delivered && (
        <button
          type="button"
          onClick={() => setView("steps")}
          className="mt-2 cursor-pointer text-xs font-semibold text-brand hover:underline"
        >
          Change the steps or the delivery charge
        </button>
      )}
      {view && (
        <StepsModal
          key={view}
          order={order}
          companies={companies}
          currency={currency}
          start={view}
          onClose={() => setView(null)}
        />
      )}
    </section>
  );
}

export type BackItem = {
  id: string;
  label: string;
  sku: string;
  quantity: number;
  // null while it has not arrived.
  state: "stock" | "discarded" | "none" | null;
  when: string | null;
};

// The pieces that are on their way back to you (from a return, an exchange,
// or a parcel refused at the door). Each one is settled once it arrives:
// put back into stock, or discarded. Until then stock is not touched.
export function ItemsBack({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: BackItem[];
}) {
  const [working, startWork] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const settle = (id: string, state: "stock" | "discarded" | "none" | "waiting", ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    startWork(async () => {
      const result = await settleItem(id, state);
      setError(result?.error ?? null);
    });
  };
  const waiting = items.filter((item) => item.state === null).length;

  return (
    <section className="card" data-items-back>
      <header className="flex items-center gap-2.5 px-4 pt-4 pb-2">
        <PackageCheck className="size-5 text-brand" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-xs text-stone-600">{subtitle}</p>
        </div>
        <span
          data-waiting
          className={
            "rounded-full px-2.5 py-1 text-xs font-bold " +
            (waiting ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700")
          }
        >
          {waiting ? `${waiting} not received yet` : "All settled"}
        </span>
      </header>
      <ul className="divide-y divide-stone-100 px-4 pb-3">
        {items.map((item) => (
          <li key={item.id} data-back-item={item.sku} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-semibold">
                {item.quantity} × {item.label}
              </span>
              <span className="block text-xs text-stone-500">{item.sku}</span>
            </span>
            {item.state === "stock" && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                Back in stock{item.when ? ` · ${item.when}` : ""}
              </span>
            )}
            {item.state === "discarded" && (
              <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">
                Discarded{item.when ? ` · ${item.when}` : ""}
              </span>
            )}
            {item.state === "none" && (
              <>
                <span className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-bold text-stone-700">
                  Not coming back
                </span>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => settle(item.id, "waiting")}
                  className="cursor-pointer text-xs font-semibold text-brand hover:underline"
                >
                  Undo
                </button>
              </>
            )}
            {item.state === null && (
              <span className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={working}
                  onClick={() => settle(item.id, "stock")}
                  className="btn btn-sm"
                >
                  <PackageCheck className="size-3.5" /> Back in stock
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={() =>
                    settle(
                      item.id,
                      "discarded",
                      "Mark this item as discarded? It will not be added to stock, and this can't be undone.",
                    )
                  }
                  className="btn-secondary btn-sm text-rose-700"
                >
                  <Trash2 className="size-3.5" /> Discarded
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => settle(item.id, "none")}
                  className="btn-secondary btn-sm"
                >
                  Not coming back
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="px-4 pb-3 text-sm font-semibold text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}

export type OrderDetails = {
  name: string;
  phone: string;
  phone2: string;
  country: string;
  city: string;
  area: string;
  street: string;
  cod: string;
  shippingFee: string;
  instruction: string;
};

// The pencil beside the order's date. Anyone can correct the date and the FO
// number; a System Admin can correct every detail of the order, and delete
// the order altogether.
export function EditOrder({
  orderId,
  name,
  date,
  admin,
  details,
  piecesOut,
  restockByDefault,
  status,
  label,
}: {
  // The order's status when the page was drawn, to notice a change meanwhile.
  status: string;
  // What the pencil is called where it sits (it opens the same pop-up).
  label?: string;
  orderId: string;
  name: string;
  // As 2026-11-27.
  date: string;
  admin: boolean;
  details: OrderDetails;
  // How many pieces a delete could put back into stock, and whether doing so
  // is the sensible default (it is not when the customer has them).
  piecesOut: number;
  restockByDefault: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, save, saving] = useActionState(editOrder.bind(null, orderId), null);
  const [gone, remove, removing] = useActionState(deleteOrder.bind(null, orderId), null);
  // Sent by hand, so what was typed stays in the boxes when a save is refused.
  const [, startSend] = useTransition();
  const send =
    (action: (data: FormData) => void, busy: boolean) =>
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;
      const data = new FormData(event.currentTarget);
      startSend(() => action(data));
    };
  const [seen, setSeen] = useState(result);
  if (result !== seen) {
    setSeen(result);
    if (result?.ok) setOpen(false);
  }
  // Deleted: back to the list.
  const left = useRef(false);
  useEffect(() => {
    if (gone?.go && !left.current) {
      left.current = true;
      router.push(gone.go);
      // The list may have been opened before: fetch it afresh, without the
      // order that is gone.
      router.refresh();
    }
  }, [gone, router]);

  const close = () => {
    setOpen(false);
    setDeleting(false);
  };
  const field = (label: string, input: React.ReactNode, wide = false) => (
    <label className={"block" + (wide ? " sm:col-span-2" : "")}>
      <span className="label">{label}</span>
      {input}
    </label>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label ?? (admin ? "Edit this order" : "Edit the date or FO number")}
        title={label ?? (admin ? "Edit this order" : "Edit the date or FO number")}
        className="ml-1.5 inline-flex size-6 cursor-pointer items-center justify-center rounded text-stone-400 hover:bg-brand-100 hover:text-brand"
      >
        <Pencil className="size-3.5" />
      </button>
      {open && deleting && (
        <Modal title={`Delete Order ${name}?`} onClose={close}>
          <form onSubmit={send(remove, removing || !!gone?.go)} data-delete-order>
            <input type="hidden" name="was" value={status} />
            <div className="space-y-3 p-4 text-sm">
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800">
                This removes the order for good, with everything recorded on it. It can&apos;t be
                undone.
              </p>
              {piecesOut > 0 ? (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-200 px-3 py-2.5">
                  <input
                    type="checkbox"
                    name="restock"
                    defaultChecked={restockByDefault}
                    className="mt-0.5 size-4 accent-[#5b4fd9]"
                  />
                  <span>
                    <span className="font-semibold">
                      Put its {piecesOut} {piecesOut === 1 ? "piece" : "pieces"} back into stock
                    </span>
                    <span className="block text-xs text-stone-500">
                      Tick this for an order entered by mistake. Leave it unticked if the customer
                      really has the pieces.
                    </span>
                  </span>
                </label>
              ) : (
                <p className="text-stone-600">Stock will not change: nothing of this order is out.</p>
              )}
              {gone?.error && (
                <p role="alert" className="font-semibold text-rose-700">
                  {gone.error}
                </p>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
              <button type="button" onClick={() => setDeleting(false)} className="btn-secondary">
                Back
              </button>
              <button
                type="submit"
                disabled={removing || !!gone?.go}
                className="btn bg-rose-600 px-5 hover:bg-rose-700"
              >
                <Trash2 className="size-4" /> {removing || gone?.go ? "Deleting…" : "Delete Order"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {open && !deleting && (
        <Modal title={`Edit Order ${name}`} onClose={close} wide={admin}>
          <form onSubmit={send(save, saving)} data-edit-order>
            <div className={"grid gap-3 p-4 " + (admin ? "sm:grid-cols-4" : "sm:grid-cols-2")}>
              {field(
                "FO number",
                <input
                  name="ref"
                  required
                  data-autofocus
                  defaultValue={name.startsWith("#") ? "" : name}
                  placeholder="FO001"
                  className="input font-semibold uppercase"
                />,
              )}
              {field(
                "Order date",
                <input type="date" name="orderDate" defaultValue={date} className="input" />,
              )}
              {admin && (
                <>
                  {field(
                    "COD (AED)",
                    <input name="cod" inputMode="decimal" defaultValue={details.cod} className="input tabular-nums" />,
                  )}
                  {field(
                    "Delivery fee (AED)",
                    <input
                      name="shippingFee"
                      inputMode="decimal"
                      defaultValue={details.shippingFee}
                      className="input tabular-nums"
                    />,
                  )}
                  {field(
                    "Receiver name",
                    <input name="name" defaultValue={details.name} className="input" />,
                    true,
                  )}
                  {field(
                    "Mobile 1",
                    <input name="phone" inputMode="tel" defaultValue={details.phone} className="input" />,
                  )}
                  {field(
                    "Mobile 2",
                    <input name="phone2" inputMode="tel" defaultValue={details.phone2} className="input" />,
                  )}
                  {field("Country", <input name="country" defaultValue={details.country} className="input" />)}
                  {field("City", <input name="city" defaultValue={details.city} className="input" />)}
                  {field("Area", <input name="area" defaultValue={details.area} className="input" />, true)}
                  {field(
                    "Street address",
                    <input name="street" defaultValue={details.street} className="input" />,
                    true,
                  )}
                  {field(
                    "Instruction",
                    <input name="instruction" defaultValue={details.instruction} className="input" />,
                    true,
                  )}
                </>
              )}
              {result?.error && (
                <p
                  role="alert"
                  className={"text-sm font-semibold text-rose-700 " + (admin ? "sm:col-span-4" : "sm:col-span-2")}
                >
                  {result.error}
                </p>
              )}
            </div>
            <footer className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
              {admin && (
                <button
                  type="button"
                  onClick={() => setDeleting(true)}
                  className="btn-secondary text-rose-700"
                >
                  <Trash2 className="size-4" /> Delete Order
                </button>
              )}
              <span className="ml-auto flex gap-2">
                <button type="button" onClick={close} className="btn-secondary">
                  Close
                </button>
                <button type="submit" disabled={saving} className="btn px-5">
                  {saving ? "Saving…" : "Save"}
                </button>
              </span>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

// On a returned order: whether the customer's money has been sent back yet,
// with a button to say so (or to undo it).
export function RefundSent({
  orderId,
  sentAt,
  amount,
}: {
  orderId: string;
  sentAt: string | null;
  amount: string;
}) {
  const [working, startWork] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const mark = (sent: boolean) =>
    startWork(async () => {
      const result = await markRefund(orderId, sent);
      setError(result?.error ?? null);
    });

  return (
    <div data-refund-sent className="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-semibold">
      {sentAt ? (
        <>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">
            Sent {sentAt}
          </span>
          <button
            type="button"
            disabled={working}
            onClick={() => mark(false)}
            className="cursor-pointer text-brand hover:underline"
          >
            Undo
          </button>
        </>
      ) : (
        <>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">Not sent yet</span>
          <button
            type="button"
            disabled={working}
            onClick={() => {
              if (window.confirm(`Mark the refund of ${amount} as sent to the customer?`)) mark(true);
            }}
            className="btn btn-sm"
          >
            Mark as sent
          </button>
        </>
      )}
      {error && (
        <span role="alert" className="w-full text-rose-700">
          {error}
        </span>
      )}
    </div>
  );
}

export type EditorProduct = {
  id: string;
  name: string;
  price2: number | null;
  price3: number | null;
  price4: number | null;
  variants: { id: string; size: string | null; color: string | null; price: number; stock: number }[];
};

type EditorLine = {
  key: number;
  productId: string;
  variantId: string;
  quantity: string;
  // Empty means "the product's own price"; a typed price is used as it is.
  unitPrice: string;
};

// "Edit items" on an order, for a System Admin: change what is in the order.
// Stock follows when it is saved: pieces added are taken out of stock, pieces
// removed go back.
export function ItemsEditor({
  orderId,
  name,
  currency,
  cod,
  products,
  lines,
}: {
  orderId: string;
  name: string;
  currency: string;
  cod: number;
  products: EditorProduct[];
  // What the order holds now. A price that is the product's own is passed
  // as null, so it keeps following the product's multi-piece prices.
  lines: { variantId: string; quantity: number; unitPrice: number | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [result, save, saving] = useActionState(editOrderItems.bind(null, orderId), null);
  const [seen, setSeen] = useState(result);
  const productOfVariant = (variantId: string) =>
    products.find((product) => product.variants.some((v) => v.id === variantId));
  const start = (): EditorLine[] =>
    lines.map((line, index) => ({
      key: index,
      productId: productOfVariant(line.variantId)?.id ?? "",
      variantId: line.variantId,
      quantity: String(line.quantity),
      unitPrice: line.unitPrice === null ? "" : line.unitPrice.toFixed(2),
    }));
  const [rows, setRows] = useState<EditorLine[]>(start);
  const [codText, setCodText] = useState(cod.toFixed(2));
  if (result !== seen) {
    setSeen(result);
    if (result?.ok) setOpen(false);
  }

  const change = (key: number, patch: Partial<EditorLine>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  // What this order already holds of an item counts as available to it.
  const held = (variantId: string) =>
    lines.filter((line) => line.variantId === variantId).reduce((sum, line) => sum + line.quantity, 0);

  // Multi-piece prices, worked out the same way as on Create Order: for each
  // product, the pieces on lines that use the product's own price are counted
  // in order; the first costs the full price, the next ones what the table says.
  const counted = new Map<string, { pieces: number; one: number }>();
  const priced = rows.map((row) => {
    const product = products.find((p) => p.id === row.productId);
    const variant = product?.variants.find((v) => v.id === row.variantId);
    const quantity = Number(row.quantity);
    const okQuantity = Number.isInteger(quantity) && quantity >= 1;
    if (!product || !variant || !okQuantity) {
      return { row, product, variant, ready: false, unit: 0, discount: 0, total: 0, short: false };
    }
    const typed = row.unitPrice.trim();
    const unit = typed === "" ? variant.price : Number(typed);
    if (!Number.isFinite(unit) || unit < 0) {
      return { row, product, variant, ready: false, unit: 0, discount: 0, total: 0, short: false };
    }
    let total = quantity * unit;
    if (typed === "") {
      const tally = counted.get(product.id) ?? { pieces: 0, one: variant.price };
      let cents = 0;
      for (let piece = 0; piece < quantity; piece++) {
        tally.pieces++;
        cents += Math.round(Math.min(variant.price, pieceCost(tally.one, product, tally.pieces)) * 100);
      }
      counted.set(product.id, tally);
      total = cents / 100;
    }
    const taken = rows
      .filter((other) => other.variantId === variant.id)
      .reduce((sum, other) => sum + (Number(other.quantity) || 0), 0);
    return {
      row,
      product,
      variant,
      ready: true,
      unit,
      discount: Math.max(0, Math.round((quantity * unit - total) * 100) / 100),
      total,
      short: taken > variant.stock + held(variant.id),
    };
  });
  const allReady = priced.length > 0 && priced.every((line) => line.ready && !line.short);
  const itemsTotal = priced.reduce((sum, line) => sum + line.total, 0);
  const money = (value: number) => `${currency} ${value.toFixed(2)}`;
  const what = (v: { size: string | null; color: string | null }) =>
    [v.size, v.color].filter(Boolean).join(" ") || "One kind";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRows(start());
          setCodText(cod.toFixed(2));
          setOpen(true);
        }}
        className="btn-secondary btn-sm ml-auto"
      >
        <Pencil className="size-3.5" /> Edit items
      </button>
      {open && (
        <Modal
          wide
          title={`Edit the items of Order ${name}`}
          subtitle="Stock follows when you save: pieces added are taken out of stock, pieces removed go back."
          onClose={() => setOpen(false)}
        >
          <form action={save} data-items-editor>
            <input
              type="hidden"
              name="items"
              value={JSON.stringify(
                priced
                  .filter((line) => line.ready)
                  .map((line) => ({
                    variantId: line.variant!.id,
                    quantity: Number(line.row.quantity),
                    unitPrice: line.unit,
                    discount: line.discount,
                  })),
              )}
            />
            <div className="space-y-2 p-4">
              {priced.map(({ row, product, variant, ready, total, short }) => (
                <div
                  key={row.key}
                  data-edit-line
                  className="grid items-center gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_5rem_6.5rem_6.5rem_2.25rem]"
                >
                  <select
                    aria-label="Product"
                    value={row.productId}
                    onChange={(event) =>
                      change(row.key, { productId: event.target.value, variantId: "", unitPrice: "" })
                    }
                    className="input"
                  >
                    <option value="">Choose product…</option>
                    {products.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Size and color"
                    value={row.variantId}
                    disabled={!product}
                    onChange={(event) => change(row.key, { variantId: event.target.value, unitPrice: "" })}
                    className="input"
                  >
                    <option value="">Size and color…</option>
                    {product?.variants.map((option) => (
                      <option key={option.id} value={option.id}>
                        {what(option)} — {option.stock + held(option.id)} available
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Quantity"
                    inputMode="numeric"
                    value={row.quantity}
                    onChange={(event) => change(row.key, { quantity: event.target.value })}
                    className={"input text-center tabular-nums " + (short ? "border-rose-500" : "")}
                  />
                  <input
                    aria-label="Unit price"
                    inputMode="decimal"
                    value={row.unitPrice}
                    placeholder={variant ? variant.price.toFixed(2) : "0.00"}
                    onChange={(event) => change(row.key, { unitPrice: event.target.value })}
                    className="input text-right tabular-nums"
                  />
                  <span data-edit-total className="text-right text-sm font-bold tabular-nums">
                    {ready ? money(total) : "—"}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove item"
                    onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}
                    className="btn-secondary px-2.5 text-rose-700"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  {short && variant && (
                    <p className="text-xs font-semibold text-rose-700 sm:col-span-6">
                      Only {variant.stock + held(variant.id)} of this are available.
                    </p>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setRows((current) => [
                    ...current,
                    {
                      key: Math.max(-1, ...current.map((row) => row.key)) + 1,
                      productId: products.length === 1 ? products[0].id : "",
                      variantId: "",
                      quantity: "1",
                      unitPrice: "",
                    },
                  ])
                }
                className="btn-secondary btn-sm"
              >
                <Plus className="size-3.5" /> Add item
              </button>

              <div className="mt-2 flex flex-wrap items-end justify-end gap-4 border-t border-stone-200 pt-3 text-sm">
                <p className="tabular-nums">
                  Items come to <b data-edit-sum>{money(itemsTotal)}</b>
                </p>
                <label className="block">
                  <span className="label">COD ({currency})</span>
                  <input
                    name="cod"
                    aria-label="COD"
                    inputMode="decimal"
                    value={codText}
                    onChange={(event) => setCodText(event.target.value)}
                    className="input w-32 text-right font-bold tabular-nums"
                  />
                </label>
              </div>
              <p className="text-right text-xs text-stone-500">
                The COD is what the customer pays. It is not changed for you: set it here if the
                items changed what they owe.
              </p>
              {result?.error && (
                <p role="alert" className="text-sm font-semibold text-rose-700">
                  {result.error}
                </p>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
                Close
              </button>
              <button type="submit" disabled={saving || !allReady} className="btn px-5">
                {saving ? "Saving…" : "Save items"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
