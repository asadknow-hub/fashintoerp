"use client";

import {
  ArrowLeftRight,
  Ban,
  Info,
  ListChecks,
  PackageCheck,
  Pencil,
  Repeat,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { deleteOrder, editOrder, markRefund, settleItem } from "../actions";
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
}: {
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
        aria-label={admin ? "Edit this order" : "Edit the date or FO number"}
        title={admin ? "Edit this order" : "Edit the date or FO number"}
        className="ml-1.5 inline-flex size-6 cursor-pointer items-center justify-center rounded text-stone-400 hover:bg-brand-100 hover:text-brand"
      >
        <Pencil className="size-3.5" />
      </button>
      {open && deleting && (
        <Modal title={`Delete Order ${name}?`} onClose={close}>
          <form action={remove} data-delete-order>
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
          <form action={save} data-edit-order>
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
