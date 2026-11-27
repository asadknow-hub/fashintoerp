"use client";

import { ArrowLeft, ListChecks, Repeat, Undo2 } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Modal } from "@/components/modal";
import { createReturn, setOrderProgress } from "./actions";

export type Company = { id: string; name: string; rate: number };

// The steps an open order moves through.
export type Stage = "new" | "portal" | "dispatched" | "delivered";

// An order as the list and the board show it, already written out for the
// screen (dates and money are text).
export type OrderCard = {
  id: string;
  number: number;
  // What the order is called: its FO number.
  name: string;
  customer: string;
  phone: string | null;
  stage: Stage | "closed";
  // "Dubai · Dubai Marina" and "2 M Black, 1 M White".
  place: string;
  contents: string;
  cod: string;
  exchange: boolean;
  // For an exchange: the order it replaces, what was in it, and whether
  // those pieces came back ("back" = that order was itself returned or
  // cancelled, so they are in stock already).
  oldItems: {
    of: string;
    contents: string;
    state: "ask" | "received" | "not" | "back";
    when: string | null;
  } | null;
  company: string | null;
  companyId: string | null;
  // When each step was done; null if not yet.
  portalAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  deliveryCharge: number | null;
};

// The "Actions" button on an order, and its pop-up.
export function OrderActions({
  order,
  companies,
  currency,
}: {
  order: OrderCard;
  companies: Company[];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Actions for order ${order.name}`}
        className="btn-secondary btn-sm whitespace-nowrap"
      >
        <ListChecks className="size-3.5" /> Actions
      </button>
      {open && (
        <StepsModal
          order={order}
          companies={companies}
          currency={currency}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// Tick what has happened to an order so far, or turn it into a return or an
// exchange. `preset` opens it with the ticks already set for a step (used
// when a card is dropped on a column of the board); nothing is saved until
// Save is pressed.
export function StepsModal({
  order,
  companies,
  currency,
  preset,
  onClose,
}: {
  order: OrderCard;
  companies: Company[];
  currency: string;
  preset?: Stage;
  onClose: () => void;
}) {
  const [result, run, pending] = useActionState(setOrderProgress.bind(null, order.id), null);
  const [returned, sendBack, returning] = useActionState(createReturn.bind(null, order.id), null);
  const [seen, setSeen] = useState(result);
  const [seenReturn, setSeenReturn] = useState(returned);
  const [view, setView] = useState<"steps" | "return">("steps");
  const rank = { new: 0, portal: 1, dispatched: 2, delivered: 3 };
  const [portal, setPortal] = useState(preset ? rank[preset] >= 1 : order.portalAt !== null);
  const [dispatched, setDispatched] = useState(
    preset ? rank[preset] >= 2 : order.dispatchedAt !== null,
  );
  const [delivered, setDelivered] = useState(
    preset ? rank[preset] >= 3 : order.deliveredAt !== null,
  );
  const [companyId, setCompanyId] = useState(
    order.companyId ?? (companies.length === 1 ? companies[0].id : ""),
  );
  // Empty until someone types: then it follows the chosen company's usual charge.
  const [charge, setCharge] = useState(
    order.deliveryCharge === null ? "" : String(order.deliveryCharge),
  );
  const [oldItems, setOldItems] = useState(order.oldItems?.state === "not" ? "not" : "");
  const [customerPays, setCustomerPays] = useState(false);
  const [returnFee, setReturnFee] = useState("");

  // Saved: the page behind already shows the change.
  if (result !== seen) {
    setSeen(result);
    if (result?.ok) onClose();
  }
  if (returned !== seenReturn) {
    setSeenReturn(returned);
    if (returned?.ok) onClose();
  }

  const company = companies.find((c) => c.id === companyId);
  const usual = company ? company.rate.toFixed(2) : "";
  const chargeShown = charge === "" ? usual : charge;
  const returnFeeShown = returnFee === "" ? usual : returnFee;

  const row = "flex items-start gap-3 rounded-lg border border-stone-200 px-3 py-2.5";
  const box = "mt-0.5 size-4 cursor-pointer accent-[#5b4fd9]";
  const when = (text: string | null) =>
    text && <span className="ml-2 text-xs font-normal text-stone-500">done {text}</span>;

  if (view === "return") {
    return (
      <Modal
        title={`Return for Order ${order.name}`}
        subtitle={`${order.customer} — ${order.contents}`}
        onClose={onClose}
      >
        <form
          data-order-return
          onSubmit={(event) => {
            event.preventDefault();
            if (returning) return;
            const data = new FormData(event.currentTarget);
            startTransition(() => sendBack(data));
          }}
        >
          <div className="space-y-3 p-4 text-sm">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              This turns the order into a return. Its items go back into your stock and it no
              longer counts as a sale.
            </p>
            <div className={row}>
              <input
                id={`pays-${order.id}`}
                type="checkbox"
                name="customerPays"
                checked={customerPays}
                onChange={(event) => setCustomerPays(event.target.checked)}
                className={box}
              />
              <div className="min-w-0 flex-1">
                <label htmlFor={`pays-${order.id}`} className="cursor-pointer font-semibold">
                  Customer agreed to cover the delivery cost
                </label>
                {customerPays && (
                  <label className="mt-2 block">
                    <span className="label">How much the customer pays ({currency})</span>
                    <input
                      name="returnFee"
                      aria-label="Delivery cost the customer covers"
                      inputMode="decimal"
                      value={returnFeeShown}
                      onChange={(event) => setReturnFee(event.target.value)}
                      placeholder="0.00"
                      className="input max-w-40 tabular-nums"
                    />
                    <span className="mt-1 block text-xs text-stone-500">
                      {company
                        ? `${company.name} usually charges ${currency} ${company.rate.toFixed(2)}. Change it if it was something else.`
                        : "Type what was agreed."}
                    </span>
                  </label>
                )}
              </div>
            </div>
            {returned?.error && (
              <p role="alert" className="text-sm font-semibold text-rose-700">
                {returned.error}
              </p>
            )}
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
            <button type="button" onClick={() => setView("steps")} className="btn-secondary">
              <ArrowLeft className="size-4" /> Back
            </button>
            <button
              type="submit"
              disabled={returning}
              className="btn ml-auto bg-rose-600 px-5 hover:bg-rose-700"
            >
              <Undo2 className="size-4" /> {returning ? "Creating…" : "Create Return"}
            </button>
          </footer>
        </form>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Order ${order.name}`}
      subtitle={`${order.customer} — tick what has been done`}
      onClose={onClose}
    >
      <form
        data-order-steps
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          const data = new FormData(event.currentTarget);
          startTransition(() => run(data));
        }}
      >
        <div className="space-y-2.5 p-4 text-sm">
          <div className={row}>
            <input
              id={`portal-${order.id}`}
              type="checkbox"
              name="portal"
              checked={portal}
              onChange={(event) => {
                setPortal(event.target.checked);
                // Undoing a step undoes the ones after it.
                if (!event.target.checked) {
                  setDispatched(false);
                  setDelivered(false);
                }
              }}
              className={box}
            />
            <div className="min-w-0 flex-1">
              <label htmlFor={`portal-${order.id}`} className="cursor-pointer font-semibold">
                Created in delivery portal
                {when(order.portalAt)}
              </label>
              {portal && (
                <div className="mt-2">
                  <label className="block">
                    <span className="label">Which company?</span>
                    <select
                      name="companyId"
                      aria-label="Delivery company"
                      value={companyId}
                      onChange={(event) => setCompanyId(event.target.value)}
                      className="input"
                    >
                      <option value="">Choose the delivery company</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} — {currency} {c.rate.toFixed(2)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {companies.length === 0 && (
                    <p className="mt-1.5 text-xs text-amber-800">
                      No delivery companies yet.{" "}
                      <Link href="/settings#delivery-companies" className="font-semibold underline">
                        Add them in Settings
                      </Link>{" "}
                      with their name and delivery charge.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={row}>
            <input
              id={`dispatched-${order.id}`}
              type="checkbox"
              name="dispatched"
              checked={dispatched}
              onChange={(event) => {
                setDispatched(event.target.checked);
                if (event.target.checked) setPortal(true);
                else setDelivered(false);
              }}
              className={box}
            />
            <label htmlFor={`dispatched-${order.id}`} className="cursor-pointer font-semibold">
              Dispatched
              {when(order.dispatchedAt)}
            </label>
          </div>

          <div className={row}>
            <input
              id={`delivered-${order.id}`}
              type="checkbox"
              name="delivered"
              checked={delivered}
              onChange={(event) => {
                setDelivered(event.target.checked);
                if (event.target.checked) {
                  setPortal(true);
                  setDispatched(true);
                }
              }}
              className={box}
            />
            <div className="min-w-0 flex-1">
              <label htmlFor={`delivered-${order.id}`} className="cursor-pointer font-semibold">
                Delivered
                {when(order.deliveredAt)}
              </label>
              {delivered && (
                <label className="mt-2 block">
                  <span className="label">Confirm the delivery charge ({currency})</span>
                  <input
                    name="deliveryCharge"
                    aria-label="Delivery charge"
                    inputMode="decimal"
                    value={chargeShown}
                    onChange={(event) => setCharge(event.target.value)}
                    placeholder="0.00"
                    className="input max-w-40 tabular-nums"
                  />
                  <span className="mt-1 block text-xs text-stone-500">
                    {company
                      ? `${company.name} usually charges ${currency} ${company.rate.toFixed(2)}. Change it if this area cost something else. It comes off the COD they pay you.`
                      : "What the delivery company keeps from the COD for this order."}
                  </span>
                </label>
              )}
            </div>
          </div>

          {order.oldItems && delivered && (
            <div className={row + " border-violet-200 bg-violet-50"} data-old-items>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Old items from Order {order.oldItems.of}</p>
                <p className="text-xs text-stone-600">{order.oldItems.contents}</p>
                {order.oldItems.state === "received" ? (
                  <p className="mt-1.5 text-xs font-semibold text-emerald-700">
                    Received back{order.oldItems.when ? ` ${order.oldItems.when}` : ""} and added
                    to stock.
                  </p>
                ) : order.oldItems.state === "back" ? (
                  <p className="mt-1.5 text-xs text-stone-600">
                    That order was returned or cancelled, so its pieces are already back in stock.
                  </p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="oldItems"
                        value="received"
                        checked={oldItems === "received"}
                        onChange={() => setOldItems("received")}
                        className="size-4 accent-[#5b4fd9]"
                      />
                      Received back — add them to stock
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="oldItems"
                        value="not"
                        checked={oldItems === "not"}
                        onChange={() => setOldItems("not")}
                        className="size-4 accent-[#5b4fd9]"
                      />
                      Not received
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {result?.error && (
            <p role="alert" className="text-sm font-semibold text-rose-700">
              {result.error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 border-t border-stone-200 pt-3">
            <button type="button" onClick={() => setView("return")} className="btn-secondary">
              <Undo2 className="size-4" /> Create Return
            </button>
            <Link href={`/orders/new?exchange=${order.id}`} className="btn-secondary">
              <Repeat className="size-4" /> Create Exchange
            </Link>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
          <Link
            href={`/orders/${order.id}`}
            className="text-xs font-semibold text-brand hover:underline"
          >
            Open the full order
          </Link>
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="btn px-5">
              {pending ? "Saving…" : "Save"}
            </button>
          </span>
        </footer>
      </form>
    </Modal>
  );
}
