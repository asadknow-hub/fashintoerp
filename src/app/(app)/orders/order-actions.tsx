"use client";

import { ArrowLeft, Ban, ListChecks, Repeat, Undo2 } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Modal } from "@/components/modal";
import { cancelOrder, createReturn, setOrderProgress } from "./actions";

// A delivery company: what it usually charges for a delivery, and for a
// parcel that was opened and then refused.
export type Company = { id: string; name: string; rate: number; openedFee: number };

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
  // The order's state as saved, sent back with a change so that a pop-up
  // opened before someone else moved the order can't undo their change.
  status: string;
  // The order that replaced this one in an exchange, if any.
  exchangedWith: string | null;
  // "Dubai · Dubai Marina" and "2 M Black, 1 M White".
  place: string;
  contents: string;
  cod: string;
  // What the customer paid for the order: its COD, or its value when it
  // was paid beforehand. A return gives this back, less what they cover.
  paid: number;
  // For an exchange: the name of the order it replaces.
  exchangeOf: string | null;
  company: string | null;
  companyId: string | null;
  // When each step was done; null if not yet.
  portalAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  deliveryCharge: number | null;
};

// Which part of the pop-up to open on.
export type ActionView = "steps" | "return" | "cancel";

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
  // The button fills up as the three steps get ticked: a third for each,
  // yellow on the way and green once delivered.
  const done = { new: 0, portal: 1, dispatched: 2, delivered: 3, closed: 0 }[order.stage];
  const upTo = `${Math.round((done / 3) * 100)}%`;
  const fill = done === 3 ? "#6ee7b7" : "#fcd34d";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Actions for order ${order.name}`}
        data-progress={done}
        title={
          `${done} of 3 steps done` +
          (order.company ? ` · ${order.company}` : "") +
          (order.deliveryCharge !== null
            ? ` · ${currency} ${order.deliveryCharge.toFixed(2)}`
            : "")
        }
        style={
          done
            ? { background: `linear-gradient(to right, ${fill} ${upTo}, #ffffff ${upTo})` }
            : undefined
        }
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

// Tick what has happened to an order so far, or end it: cancel it, or (once
// delivered) turn it into a return or start an exchange. `preset` opens it
// with the ticks already set for a step (used when a card is dropped on a
// column of the board); nothing is saved until Save is pressed.
export function StepsModal({
  order,
  companies,
  currency,
  preset,
  start = "steps",
  onClose,
}: {
  order: OrderCard;
  companies: Company[];
  currency: string;
  preset?: Stage;
  start?: ActionView;
  onClose: () => void;
}) {
  const [result, run, pending] = useActionState(setOrderProgress.bind(null, order.id), null);
  const [returned, sendBack, returning] = useActionState(createReturn.bind(null, order.id), null);
  const [cancelled, cancel, cancelling] = useActionState(cancelOrder.bind(null, order.id), null);
  const [seen, setSeen] = useState({ result, returned, cancelled });
  const [view, setView] = useState<ActionView>(start);
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
  // Not typed yet (null): the box follows the company's usual charge. Once
  // someone types, or empties the box to type a new amount, it is theirs.
  const [charge, setCharge] = useState<string | null>(
    order.deliveryCharge === null ? null : String(order.deliveryCharge),
  );
  const [returnFee, setReturnFee] = useState<string | null>(null);
  const [returnCharge, setReturnCharge] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [cancelFee, setCancelFee] = useState<string | null>(null);

  // Saved: the page behind already shows the change.
  if (result !== seen.result || returned !== seen.returned || cancelled !== seen.cancelled) {
    setSeen({ result, returned, cancelled });
    if (
      (result !== seen.result && result?.ok) ||
      (returned !== seen.returned && returned?.ok) ||
      (cancelled !== seen.cancelled && cancelled?.ok)
    ) {
      onClose();
    }
  }

  const company = companies.find((c) => c.id === companyId);
  const usual = company ? company.rate.toFixed(2) : "";
  const chargeShown = charge ?? usual;
  const returnFeeShown = returnFee ?? usual;
  const returnChargeShown = returnCharge ?? usual;
  const cancelFeeShown = cancelFee ?? (company ? company.openedFee.toFixed(2) : "10.00");
  // A return: the customer is paid back what they paid, less the part of
  // the delivery cost they cover; the company's charge for the trip comes
  // off the payout; the gap between the two is what the return costs.
  const covers = Math.max(Number(returnFeeShown) || 0, 0);
  const tripCost = Math.max(Number(returnChargeShown) || 0, 0);
  const refund = Math.max(order.paid - covers, 0);
  const returnGap = tripCost - covers;
  const out = order.stage === "dispatched";
  const isDelivered = order.stage === "delivered";

  const row = "flex items-start gap-3 rounded-lg border border-stone-200 px-3 py-2.5";
  const box = "mt-0.5 size-4 cursor-pointer accent-[#5b4fd9]";
  const when = (text: string | null) =>
    text && <span className="ml-2 text-xs font-normal text-stone-500">done {text}</span>;
  const money = (value: number) => `${currency} ${value.toFixed(2)}`;

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
              The delivery company collects the parcel and brings it back. You send the customer
              their money by bank transfer, less the delivery cost they cover. The items go back
              into stock when you mark them received on the order.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Delivery cost the customer covers ({currency})</span>
                <input
                  name="returnFee"
                  aria-label="Delivery cost the customer covers"
                  inputMode="decimal"
                  value={returnFeeShown}
                  onChange={(event) => setReturnFee(event.target.value)}
                  placeholder="0.00"
                  className="input tabular-nums"
                />
                <span className="mt-1 block text-xs text-stone-500">
                  Normally the full charge. Lower it if they argued, or 0 if they want everything
                  back.
                </span>
              </label>
              <label className="block">
                <span className="label">
                  {company ? company.name : "Delivery company"} charges for the return ({currency})
                </span>
                <input
                  name="returnCharge"
                  aria-label="Return charge"
                  inputMode="decimal"
                  value={returnChargeShown}
                  onChange={(event) => setReturnCharge(event.target.value)}
                  placeholder="0.00"
                  className="input tabular-nums"
                />
                <span className="mt-1 block text-xs text-stone-500">Comes off your payout.</span>
              </label>
            </div>
            <dl
              data-return-math
              className="rounded-lg border border-stone-200 px-3 py-1 tabular-nums"
            >
              <div className="flex justify-between border-b border-stone-100 py-1.5">
                <dt>Customer paid</dt>
                <dd>{money(order.paid)}</dd>
              </div>
              <div className="flex justify-between border-b border-stone-100 py-1.5">
                <dt>Delivery cost they cover</dt>
                <dd>− {money(covers)}</dd>
              </div>
              <div className="flex justify-between py-1.5 font-bold">
                <dt>Refund to the customer (bank transfer)</dt>
                <dd data-refund>{money(refund)}</dd>
              </div>
            </dl>
            <p data-return-gap className="rounded-lg bg-stone-100 px-3 py-2 font-semibold">
              {returnGap > 0.004
                ? `You pay ${money(returnGap)} of the return delivery yourself.`
                : returnGap < -0.004
                  ? `The customer covers ${money(-returnGap)} more than the return delivery costs.`
                  : "The customer covers the whole return delivery."}
            </p>
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

  if (view === "cancel") {
    return (
      <Modal
        title={`Cancel Order ${order.name}`}
        subtitle={`${order.customer} — ${order.contents}`}
        onClose={onClose}
      >
        <form
          data-order-cancel
          onSubmit={(event) => {
            event.preventDefault();
            if (cancelling) return;
            const data = new FormData(event.currentTarget);
            startTransition(() => cancel(data));
          }}
        >
          <div className="space-y-3 p-4 text-sm">
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              {out
                ? "No money is collected and no delivery charge is taken. The parcel comes back with the driver: its items go back into stock when you mark them received on the order."
                : "No money is collected and no delivery charge is taken. Its items go straight back into stock."}
            </p>
            {out && (
              <div className={row}>
                <input
                  id={`opened-${order.id}`}
                  type="checkbox"
                  name="opened"
                  checked={opened}
                  onChange={(event) => setOpened(event.target.checked)}
                  className={box}
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`opened-${order.id}`} className="cursor-pointer font-semibold">
                    Customer opened the parcel, then cancelled
                  </label>
                  {opened && (
                    <label className="mt-2 block">
                      <span className="label">
                        {company ? company.name : "The delivery company"} charges ({currency})
                      </span>
                      <input
                        name="cancelFee"
                        aria-label="Charge for the opened parcel"
                        inputMode="decimal"
                        value={cancelFeeShown}
                        onChange={(event) => setCancelFee(event.target.value)}
                        placeholder="0.00"
                        className="input max-w-40 tabular-nums"
                      />
                      <span className="mt-1 block text-xs text-stone-500">
                        This comes off your payout.
                      </span>
                    </label>
                  )}
                </div>
              </div>
            )}
            {cancelled?.error && (
              <p role="alert" className="text-sm font-semibold text-rose-700">
                {cancelled.error}
              </p>
            )}
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
            <button type="button" onClick={() => setView("steps")} className="btn-secondary">
              <ArrowLeft className="size-4" /> Back
            </button>
            <button
              type="submit"
              disabled={cancelling}
              className="btn ml-auto bg-rose-600 px-5 hover:bg-rose-700"
            >
              <Ban className="size-4" /> {cancelling ? "Cancelling…" : "Cancel Order"}
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
        <input type="hidden" name="was" value={order.status} />
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

          {result?.error && (
            <p role="alert" className="text-sm font-semibold text-rose-700">
              {result.error}
            </p>
          )}

          {/* How an order ends: delivered ones can come back or be swapped,
              the others can be cancelled. */}
          {isDelivered && order.exchangedWith ? (
            <p
              data-exchanged-note
              className="border-t border-stone-200 pt-3 text-xs text-stone-600"
            >
              This order was exchanged with <b>{order.exchangedWith}</b>. A return or another
              exchange is made on that order, since the customer now has its pieces.
            </p>
          ) : isDelivered ? (
            <div className="grid grid-cols-2 gap-2 border-t border-stone-200 pt-3">
              <button type="button" onClick={() => setView("return")} className="btn-secondary">
                <Undo2 className="size-4" /> Create Return
              </button>
              <Link href={`/orders/new?exchange=${order.id}`} className="btn-secondary">
                <Repeat className="size-4" /> Create Exchange
              </Link>
            </div>
          ) : (
            <div className="border-t border-stone-200 pt-3">
              <button
                type="button"
                onClick={() => setView("cancel")}
                className="btn-secondary w-full text-rose-700"
              >
                <Ban className="size-4" /> Cancel Order
              </button>
              <p className="mt-1.5 text-center text-xs text-stone-500">
                A return or an exchange can be created once the order is delivered.
              </p>
            </div>
          )}
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
              Close
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
