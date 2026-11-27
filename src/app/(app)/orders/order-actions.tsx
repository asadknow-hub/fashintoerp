"use client";

import { ListChecks } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Modal } from "@/components/modal";
import { setOrderProgress } from "./actions";

export type Company = { id: string; name: string; rate: number };

export type OrderSteps = {
  id: string;
  number: number;
  customer: string;
  companyId: string | null;
  // When each step was done, already written out for the screen; null if not yet.
  portalAt: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  deliveryCharge: number | null;
};

// The "Actions" button on a row of the orders list, and its pop-up: tick
// what has happened to the order so far.
export function OrderActions({
  order,
  companies,
  currency,
}: {
  order: OrderSteps;
  companies: Company[];
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Actions for order #${order.number}`}
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

function StepsModal({
  order,
  companies,
  currency,
  onClose,
}: {
  order: OrderSteps;
  companies: Company[];
  currency: string;
  onClose: () => void;
}) {
  const [result, run, pending] = useActionState(setOrderProgress.bind(null, order.id), null);
  const [seen, setSeen] = useState(result);
  const [portal, setPortal] = useState(order.portalAt !== null);
  const [dispatched, setDispatched] = useState(order.dispatchedAt !== null);
  const [delivered, setDelivered] = useState(order.deliveredAt !== null);
  const [companyId, setCompanyId] = useState(
    order.companyId ?? (companies.length === 1 ? companies[0].id : ""),
  );
  // Empty until someone types: then it follows the chosen company's usual charge.
  const [charge, setCharge] = useState(
    order.deliveryCharge === null ? "" : String(order.deliveryCharge),
  );

  if (result !== seen) {
    setSeen(result);
    // Saved: the list behind already shows the new step.
    if (result?.ok) onClose();
  }

  const company = companies.find((c) => c.id === companyId);
  const usual = company ? company.rate.toFixed(2) : "";
  const chargeShown = charge === "" ? usual : charge;

  const row = "flex items-start gap-3 rounded-lg border border-stone-200 px-3 py-2.5";
  const box = "mt-0.5 size-4 cursor-pointer accent-[#5b4fd9]";
  const when = (text: string | null) =>
    text && <span className="ml-2 text-xs font-normal text-stone-500">done {text}</span>;

  return (
    <Modal
      title={`Order #${order.number}`}
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
                      ? `${company.name} usually charges ${currency} ${company.rate.toFixed(2)}. Change it if this area cost something else.`
                      : "What the delivery company charged for this order."}
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
