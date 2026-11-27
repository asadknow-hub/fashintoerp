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
import { useActionState, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { editOrder, settleItem } from "../actions";
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
      <div className="mt-3 grid grid-cols-2 gap-2">
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
        {delivered
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

// The pencil beside the order's date: change the date or the FO number.
export function EditOrder({
  orderId,
  name,
  date,
}: {
  orderId: string;
  name: string;
  // As 2026-11-27.
  date: string;
}) {
  const [open, setOpen] = useState(false);
  const [result, save, saving] = useActionState(editOrder.bind(null, orderId), null);
  const [seen, setSeen] = useState(result);
  if (result !== seen) {
    setSeen(result);
    if (result?.ok) setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit the date or FO number"
        title="Edit the date or FO number"
        className="ml-1.5 inline-flex size-6 cursor-pointer items-center justify-center rounded text-stone-400 hover:bg-brand-100 hover:text-brand"
      >
        <Pencil className="size-3.5" />
      </button>
      {open && (
        <Modal title={`Edit Order ${name}`} onClose={() => setOpen(false)}>
          <form action={save} data-edit-order>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <label className="block">
                <span className="label">FO number</span>
                <input
                  name="ref"
                  required
                  data-autofocus
                  defaultValue={name.startsWith("#") ? "" : name}
                  placeholder="FO001"
                  className="input font-semibold uppercase"
                />
              </label>
              <label className="block">
                <span className="label">Order date</span>
                <input
                  type="date"
                  name="orderDate"
                  defaultValue={date}
                  className="input"
                />
              </label>
              {result?.error && (
                <p role="alert" className="text-sm font-semibold text-rose-700 sm:col-span-2">
                  {result.error}
                </p>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
                Close
              </button>
              <button type="submit" disabled={saving} className="btn px-5">
                {saving ? "Saving…" : "Save"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
