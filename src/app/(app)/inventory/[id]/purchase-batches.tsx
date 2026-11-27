"use client";

import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import type { ActionState } from "@/components/action-form";
import { Block } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { addPurchase, deletePurchase, updatePurchase } from "../actions";

export type Batch = {
  id: string;
  date: string;
  note: string | null;
  units: number;
  totalCost: number | null;
};

// Every lot of stock that was bought: how many, at what cost each, and the
// total paid. A row can be opened to correct it; "Add batch" records a cost
// for stock that was already here. None of this changes stock.
export function PurchaseBatches({
  productId,
  batches,
  currency,
  unitsInStock,
}: {
  productId: string;
  batches: Batch[];
  currency: string;
  unitsInStock: number;
}) {
  // The id of the row being edited, or "new" while adding one.
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, startWork] = useTransition();

  const priced = batches.filter((batch) => batch.totalCost !== null);
  const units = batches.reduce((sum, batch) => sum + batch.units, 0);
  const paid = priced.reduce((sum, batch) => sum + batch.totalCost!, 0);
  const pricedUnits = priced.reduce((sum, batch) => sum + batch.units, 0);

  const run = (work: () => Promise<ActionState>) =>
    startWork(async () => {
      const result = await work();
      setError(result?.error ?? null);
      if (!result?.error) setOpen(null);
    });

  const editor = (batch: Batch | null) => (
    <tr data-batch-editor>
      <td colSpan={6} className="bg-brand-50 px-3 py-2.5">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(() =>
              batch ? updatePurchase(batch.id, null, data) : addPurchase(productId, null, data),
            );
          }}
        >
          <label className="min-w-40 flex-1">
            <span className="label">Supplier / Batch</span>
            <input
              name="note"
              defaultValue={batch?.note ?? ""}
              placeholder="Supplier name or batch number"
              className="input"
            />
          </label>
          <label className="w-24">
            <span className="label">Units</span>
            <input
              name="units"
              inputMode="numeric"
              required
              defaultValue={batch?.units ?? (unitsInStock || "")}
              className="input"
            />
          </label>
          <label className="w-36">
            <span className="label">Total cost ({currency})</span>
            <input
              name="totalPaid"
              inputMode="decimal"
              required={!batch}
              defaultValue={batch?.totalCost ?? ""}
              className="input"
            />
          </label>
          <button type="submit" disabled={working} className="btn">
            {working ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setOpen(null)} className="btn-secondary">
            Cancel
          </button>
          {batch && (
            <button
              type="button"
              disabled={working}
              aria-label="Delete this batch"
              title="Delete this record (stock is not changed)"
              onClick={() => {
                if (window.confirm("Delete this purchase record? Stock will not change.")) {
                  run(() => deletePurchase(batch.id));
                }
              }}
              className="btn-secondary px-2.5 text-rose-700"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <p className="w-full text-[11px] text-stone-500">
            {batch
              ? "This corrects the record only. It does not add or remove stock."
              : "Use this to record what stock already in the system cost. It does not add stock; use Receive Stock for a new delivery."}
          </p>
          {error && (
            <p role="alert" className="w-full text-xs font-semibold text-rose-700">
              {error}
            </p>
          )}
        </form>
      </td>
    </tr>
  );

  return (
    <Block
      title="Purchase Batches"
      subtitle="Received stock history (purchases)"
      icon={<Boxes />}
      flush
      aside={
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpen(open === "new" ? null : "new");
          }}
          className="btn-secondary btn-sm"
        >
          <Plus className="size-3.5" /> Add batch
        </button>
      }
    >
      <div className="overflow-x-auto px-4 pb-4" data-purchases>
        <table className="w-full min-w-[30rem] border-collapse overflow-hidden rounded-lg text-sm tabular-nums">
          <thead>
            <tr>
              <th className="th rounded-l-lg">Date</th>
              <th className="th">Supplier / Batch</th>
              <th className="th text-center">Units Purchased</th>
              <th className="th text-right">Unit Cost</th>
              <th className="th text-right">Total Cost</th>
              <th className="th w-8 rounded-r-lg" />
            </tr>
          </thead>
          <tbody>
            {open === "new" && editor(null)}
            {batches.length === 0 && open !== "new" && (
              <tr>
                <td colSpan={6} className="td py-4 text-center text-stone-500">
                  No purchases recorded yet. Use Receive Stock when a delivery arrives.
                </td>
              </tr>
            )}
            {batches.flatMap((batch) => [
              <tr
                key={batch.id}
                data-purchase
                onClick={() => {
                  setError(null);
                  setOpen(open === batch.id ? null : batch.id);
                }}
                className="cursor-pointer border-b border-stone-100 hover:bg-stone-50"
              >
                <td className="td whitespace-nowrap">{batch.date}</td>
                <td className="td">{batch.note ?? "—"}</td>
                <td className="td text-center font-bold">{batch.units}</td>
                <td className="td text-right">
                  {batch.totalCost === null
                    ? "—"
                    : formatMoney(batch.totalCost / batch.units, currency)}
                </td>
                <td className="td text-right">
                  {batch.totalCost === null ? (
                    <span className="font-semibold text-amber-700">Add cost</span>
                  ) : (
                    formatMoney(batch.totalCost, currency)
                  )}
                </td>
                <td className="td text-stone-400">
                  <Pencil className="size-3.5" aria-label="Edit" />
                </td>
              </tr>,
              open === batch.id ? <EditorRow key={batch.id + "-edit"}>{editor(batch)}</EditorRow> : null,
            ])}
          </tbody>
          <tfoot>
            <tr className="bg-brand-100 font-bold">
              <td className="td rounded-l-lg" colSpan={2}>
                Total
              </td>
              <td className="td text-center" data-total="units">
                {units}
              </td>
              <td className="td text-right" data-total="average">
                <span className="mr-1.5 text-xs font-semibold text-stone-600">Average</span>
                {pricedUnits ? formatMoney(paid / pricedUnits, currency) : "—"}
              </td>
              <td className="td rounded-r-lg bg-brand text-right text-white" colSpan={2} data-total="paid">
                {formatMoney(paid, currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Block>
  );
}

// Lets the editor row sit in the list of rows with its own key.
function EditorRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
