"use client";

import { Route } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { correctJourney } from "../actions";
import type { Company } from "../order-actions";

type Target = "new" | "portal" | "dispatched" | "delivered" | "cancelled" | "returned";

const targets: { key: Target; label: string; hint: string }[] = [
  { key: "new", label: "New", hint: "Not entered with a delivery company yet" },
  { key: "portal", label: "In portal", hint: "Entered with the delivery company, not sent out" },
  { key: "dispatched", label: "Dispatched", hint: "On its way to the customer" },
  { key: "delivered", label: "Delivered", hint: "The customer has it and paid" },
  { key: "cancelled", label: "Cancelled", hint: "The customer did not take it" },
  { key: "returned", label: "Returned", hint: "Was delivered, then sent back" },
];

// "Correct journey" on the order page, for the System Admin: when an order
// was marked wrongly (delivered when it was really cancelled, and so on),
// set what really happened to it. Every state can be reached from any other;
// the money fields each state needs are asked here.
export function CorrectJourney({
  orderId,
  name,
  status,
  current,
  companies,
  companyId,
  deliveryCharge,
  returnFee,
  returnCharge,
  cancelFee,
  sentOut,
  paid,
  piecesBack,
  exchangedWith,
  currency,
}: {
  orderId: string;
  name: string;
  // The order's status as stored, to notice someone else changing it meanwhile.
  status: string;
  current: Target;
  companies: Company[];
  companyId: string | null;
  // What is recorded on the order now (null where nothing is).
  deliveryCharge: number | null;
  returnFee: number | null;
  returnCharge: number | null;
  cancelFee: number | null;
  // Whether the parcel was handed to the delivery company.
  sentOut: boolean;
  // What the customer paid for the goods: what a return gives back.
  paid: number;
  // Pieces of this order that were put back into stock.
  piecesBack: number;
  // The order that replaced this one in an exchange, if any.
  exchangedWith: string | null;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [result, save, saving] = useActionState(correctJourney.bind(null, orderId), null);
  const [, startTransition] = useTransition();
  const [seen, setSeen] = useState(result);
  if (result !== seen) {
    setSeen(result);
    if (result?.ok) setOpen(false);
  }

  const [target, setTarget] = useState<Target>(current);
  const [company, setCompany] = useState(companyId ?? companies[0]?.id ?? "");
  const [out, setOut] = useState(sentOut);
  const [opened, setOpened] = useState(cancelFee !== null);
  const [fee, setFee] = useState<string | null>(null);
  const start = () => {
    setTarget(current);
    setCompany(companyId ?? companies[0]?.id ?? "");
    setOut(sentOut);
    setOpened(cancelFee !== null);
    setFee(null);
    setOpen(true);
  };

  const chosen = companies.find((one) => one.id === company);
  // What is recorded stays; an empty field starts from the company's rate.
  const money = (recorded: number | null, standard: number | undefined) =>
    (recorded ?? standard ?? 0).toFixed(2);
  const feeShown = fee ?? money(returnFee, chosen?.rate);
  const refund = Math.max(paid - (Number(feeShown) || 0), 0);

  const leftBuilding = target === "cancelled" ? out : ["dispatched", "delivered", "returned"].includes(target);
  const withCompany = target === "portal" || leftBuilding;
  const reached = target === "delivered" || target === "returned";
  const closing = target === "cancelled" || target === "returned";
  const wasClosed = current === "cancelled" || current === "returned";
  const stock = closing
    ? leftBuilding
      ? "Its pieces are on their way back: mark each one on this page when it arrives. Pieces already marked stay as they are."
      : "Its pieces go back into stock now."
    : piecesBack > 0 && (wasClosed || target !== "delivered")
      ? `${piecesBack} ${piecesBack === 1 ? "piece that was" : "pieces that were"} put back into stock for this order ${piecesBack === 1 ? "is" : "are"} taken out again.`
      : "Stock does not change.";

  const box = "mt-0.5 size-4 shrink-0 accent-[#5b4fd9]";
  const number = "input max-w-40 tabular-nums";

  return (
    <>
      <button
        type="button"
        onClick={start}
        data-correct-journey
        title="Set what really happened to this order"
        className="btn-secondary btn-sm whitespace-nowrap"
      >
        <Route className="size-3.5" /> Correct journey
      </button>
      {open && (
        <Modal
          title={`Correct the journey of Order ${name}`}
          subtitle="For an order that was marked wrongly: set what really happened to it."
          onClose={() => setOpen(false)}
        >
          {exchangedWith ? (
            <div className="space-y-3 p-4 text-sm" data-journey-form>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                This order was exchanged with <b>{exchangedWith}</b>, so what happened next is on
                that order. Correct that order first (cancel it if the exchange never happened),
                then come back to this one.
              </p>
            </div>
          ) : (
            <form
              data-journey-form
              onSubmit={(event) => {
                event.preventDefault();
                if (saving) return;
                const data = new FormData(event.currentTarget);
                startTransition(() => save(data));
              }}
            >
              <input type="hidden" name="was" value={status} />
              <div className="space-y-3 p-4 text-sm">
                <fieldset>
                  <legend className="label">What really happened</legend>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {targets.map((option) => (
                      <label
                        key={option.key}
                        data-target={option.key}
                        className={
                          "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 " +
                          (target === option.key
                            ? "border-brand bg-brand-50"
                            : "border-stone-200 hover:bg-stone-50")
                        }
                      >
                        <input
                          type="radio"
                          name="target"
                          value={option.key}
                          checked={target === option.key}
                          onChange={() => setTarget(option.key)}
                          className={box}
                        />
                        <span className="min-w-0">
                          <span className="font-semibold">
                            {option.label}
                            {option.key === current && (
                              <span className="ml-1.5 rounded bg-stone-200 px-1.5 py-0.5 text-[10px] font-bold text-stone-600 uppercase">
                                now
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-stone-500">{option.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {target === "cancelled" && (
                  <div className="space-y-2 rounded-lg border border-stone-200 px-3 py-2.5">
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        name="sentOut"
                        checked={out}
                        onChange={(event) => {
                          setOut(event.target.checked);
                          if (!event.target.checked) setOpened(false);
                        }}
                        className={box}
                      />
                      <span>
                        <span className="font-semibold">The parcel had been sent out</span>
                        <span className="block text-xs text-stone-500">
                          Untick if it was cancelled before it left you.
                        </span>
                      </span>
                    </label>
                    {out && (
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          name="opened"
                          checked={opened}
                          onChange={(event) => setOpened(event.target.checked)}
                          className={box}
                        />
                        <span className="font-semibold">
                          The customer opened the parcel, then cancelled
                        </span>
                      </label>
                    )}
                    {out && opened && (
                      <label className="block pl-6">
                        <span className="label">
                          {chosen ? chosen.name : "The delivery company"} charges ({currency})
                        </span>
                        <input
                          key={company}
                          name="cancelFee"
                          aria-label="Charge for the opened parcel"
                          inputMode="decimal"
                          defaultValue={money(cancelFee, chosen?.openedFee)}
                          className={number}
                        />
                      </label>
                    )}
                  </div>
                )}

                {withCompany && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="label">Delivery company</span>
                      <select
                        name="companyId"
                        value={company}
                        onChange={(event) => setCompany(event.target.value)}
                        className="input"
                      >
                        {companies.length === 0 && <option value="">Add one in Settings first</option>}
                        {companies.map((one) => (
                          <option key={one.id} value={one.id}>
                            {one.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {reached && (
                      <label className="block">
                        <span className="label">Delivery charge ({currency})</span>
                        <input
                          key={company}
                          name="deliveryCharge"
                          aria-label="Delivery charge"
                          inputMode="decimal"
                          defaultValue={money(deliveryCharge, chosen?.rate)}
                          className={number}
                        />
                      </label>
                    )}
                  </div>
                )}

                {target === "returned" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="label">Customer covers of the delivery ({currency})</span>
                      <input
                        name="returnFee"
                        aria-label="Customer covers"
                        inputMode="decimal"
                        value={feeShown}
                        onChange={(event) => setFee(event.target.value)}
                        className={number}
                      />
                      <span className="mt-1 block text-xs text-stone-500" data-journey-refund>
                        Refund to the customer: {currency} {refund.toFixed(2)}
                      </span>
                    </label>
                    <label className="block">
                      <span className="label">Return charge ({currency})</span>
                      <input
                        key={company}
                        name="returnCharge"
                        aria-label="Return charge"
                        inputMode="decimal"
                        defaultValue={money(returnCharge, chosen?.rate)}
                        className={number}
                      />
                    </label>
                  </div>
                )}

                <p data-journey-stock className="rounded-lg bg-stone-100 px-3 py-2 text-stone-700">
                  {stock}
                </p>
                <p className="text-xs text-stone-500">
                  The correction is written on the order&apos;s timeline and in the Activity Log
                  with your name.
                </p>
                {result?.error && (
                  <p role="alert" className="font-semibold text-rose-700">
                    {result.error}
                  </p>
                )}
              </div>
              <footer className="flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
                  Close
                </button>
                <button type="submit" disabled={saving} className="btn px-5">
                  {saving ? "Saving…" : "Save correction"}
                </button>
              </footer>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
