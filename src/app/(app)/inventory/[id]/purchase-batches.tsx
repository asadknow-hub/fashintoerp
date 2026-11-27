"use client";

import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { startTransition, useActionState, useEffect, useState } from "react";
import type { ActionState } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Block } from "@/components/ui";
import { colorDot } from "@/lib/colors";
import { formatMoney } from "@/lib/format";
import { deletePurchase, saveBatch } from "../actions";

export type Batch = {
  id: string;
  date: string;
  note: string | null;
  units: number;
  totalCost: number | null;
  // How many of each size and color came in. Empty for old records that
  // were only ever a note of what some stock cost.
  lines: { variantId: string; quantity: number }[];
};

export type BatchVariant = {
  id: string;
  size: string | null;
  color: string | null;
  stock: number;
};

type Job = { kind: "save"; batchId: string | null; data: FormData } | { kind: "delete"; batchId: string };

// Every batch of stock that was bought: how many, at what cost each, and the
// total paid. "Add batch" (and "Receive Stock" at the top of the page) opens
// a pop-up to type what arrived; clicking a row opens the same pop-up with
// what was recorded.
export function PurchaseBatches({
  productId,
  batches,
  variants,
  sizes,
  colors,
  currency,
}: {
  productId: string;
  batches: Batch[];
  variants: BatchVariant[];
  sizes: (string | null)[];
  colors: (string | null)[];
  currency: string;
}) {
  // One save path, so the pop-up closes in the same screen update that
  // brings the fresh numbers.
  const [result, run, pending] = useActionState(
    (state: ActionState, job: Job) =>
      job.kind === "save"
        ? saveBatch(productId, job.batchId, state, job.data)
        : deletePurchase(job.batchId),
    null,
  );
  const [seen, setSeen] = useState(result);
  // The id of the batch being edited, or "new" while adding one.
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (result !== seen) {
    setSeen(result);
    setError(result?.error ?? null);
    // On an error the pop-up stays open with everything typed.
    if (!result?.error) setOpen(null);
  }

  const show = (id: string) => {
    setError(null);
    setOpen(id);
  };

  // The "Receive Stock" button at the top of the page opens the pop-up too.
  useEffect(() => {
    const receive = () => {
      setError(null);
      setOpen("new");
    };
    window.addEventListener("stock:receive", receive);
    return () => window.removeEventListener("stock:receive", receive);
  }, []);

  const priced = batches.filter((batch) => batch.totalCost !== null);
  const units = batches.reduce((sum, batch) => sum + batch.units, 0);
  const paid = priced.reduce((sum, batch) => sum + batch.totalCost!, 0);
  const pricedUnits = priced.reduce((sum, batch) => sum + batch.units, 0);
  const editing = batches.find((batch) => batch.id === open) ?? null;

  return (
    <Block
      title="Purchase Batches"
      subtitle="Received stock history (purchases)"
      icon={<Boxes />}
      flush
      aside={
        <button type="button" onClick={() => show("new")} className="btn-secondary btn-sm">
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
            {batches.length === 0 && (
              <tr>
                <td colSpan={6} className="td py-4 text-center text-stone-500">
                  No purchases recorded yet. Use Add batch when a delivery arrives.
                </td>
              </tr>
            )}
            {batches.map((batch) => (
              <tr
                key={batch.id}
                data-purchase
                onClick={() => show(batch.id)}
                className="cursor-pointer border-b border-stone-100 hover:bg-stone-50"
              >
                <td className="td whitespace-nowrap">{batch.date}</td>
                <td className="td">{batch.note ?? "—"}</td>
                <td className="td text-center font-bold">{batch.units}</td>
                <td className="td text-right whitespace-nowrap">
                  {batch.totalCost === null
                    ? "—"
                    : formatMoney(batch.totalCost / batch.units, currency)}
                </td>
                <td className="td text-right whitespace-nowrap">
                  {batch.totalCost === null ? (
                    <span className="font-semibold text-amber-700">Add cost</span>
                  ) : (
                    formatMoney(batch.totalCost, currency)
                  )}
                </td>
                <td className="td text-stone-400">
                  <button
                    type="button"
                    aria-label="Edit this batch"
                    className="cursor-pointer rounded p-0.5 hover:text-brand"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
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

      {open !== null && (open === "new" || editing) && (
        <BatchModal
          key={open}
          batch={editing}
          variants={variants}
          sizes={sizes}
          colors={colors}
          currency={currency}
          error={error}
          pending={pending}
          onClose={() => setOpen(null)}
          onSave={(data) =>
            startTransition(() => run({ kind: "save", batchId: editing?.id ?? null, data }))
          }
          onDelete={() => startTransition(() => run({ kind: "delete", batchId: editing!.id }))}
        />
      )}
    </Block>
  );
}

const number = (text: string) => {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(value) && value >= 0 ? value : null;
};

// The pop-up for one batch: who it came from, what one piece cost, and how
// many pieces of each size and color.
function BatchModal({
  batch,
  variants,
  sizes,
  colors,
  currency,
  error,
  pending,
  onClose,
  onSave,
  onDelete,
}: {
  batch: Batch | null;
  variants: BatchVariant[];
  sizes: (string | null)[];
  colors: (string | null)[];
  currency: string;
  error: string | null;
  pending: boolean;
  onClose: () => void;
  onSave: (data: FormData) => void;
  onDelete: () => void;
}) {
  // An old record with no sizes and colors: only its numbers can be fixed.
  const recordOnly = batch !== null && batch.lines.length === 0;
  const [note, setNote] = useState(batch?.note ?? "");
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries((batch?.lines ?? []).map((line) => [line.variantId, String(line.quantity)])),
  );
  const [plainUnits, setPlainUnits] = useState(batch ? String(batch.units) : "");
  // The cost is typed either per piece or as a total; the other one follows.
  const [cost, setCost] = useState<{ by: "unit" | "total"; text: string }>(
    batch
      ? { by: "total", text: batch.totalCost === null ? "" : String(batch.totalCost) }
      : { by: "unit", text: "" },
  );

  const was = (v: BatchVariant) =>
    batch?.lines.find((line) => line.variantId === v.id)?.quantity ?? 0;
  const now = (v: BatchVariant) => {
    const value = number(typed[v.id] ?? "");
    return value !== null && Number.isInteger(value) ? value : 0;
  };
  const find = (color: string | null, size: string | null) =>
    variants.find((v) => v.color === color && v.size === size);
  const sum = (list: BatchVariant[]) => list.reduce((total, v) => total + now(v), 0);

  const pieces = recordOnly ? (number(plainUnits) ?? 0) : sum(variants);
  const typedCost = number(cost.text);
  const total =
    typedCost === null ? null : cost.by === "total" ? typedCost : typedCost * pieces;
  const unit =
    typedCost === null ? null : cost.by === "unit" ? typedCost : pieces ? typedCost / pieces : null;
  const unitShown = cost.by === "unit" ? cost.text : unit === null ? "" : unit.toFixed(2);
  const totalShown =
    cost.by === "total" ? cost.text : total === null || !pieces ? "" : total.toFixed(2);

  const submit = () => {
    const data = new FormData();
    data.set("note", note);
    // Anything typed that is not a number goes as it is, so it gets refused.
    data.set(
      "totalPaid",
      cost.text.trim() === ""
        ? ""
        : cost.by === "total" || typedCost === null
          ? cost.text.trim()
          : (typedCost * pieces).toFixed(2),
    );
    if (recordOnly) data.set("units", plainUnits.trim());
    for (const v of variants) {
      const raw = (typed[v.id] ?? "").trim();
      if (raw) data.set(`qty:${v.id}`, raw);
    }
    onSave(data);
  };

  const field = "input tabular-nums";
  return (
    <Modal
      wide
      title={batch ? "Edit Purchase Batch" : "Add Purchase Batch"}
      subtitle={
        batch
          ? `Recorded on ${batch.date}`
          : "Type how many pieces arrived of each color and size, and what one piece cost."
      }
      onClose={onClose}
    >
      <form
        data-batch-form
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) submit();
        }}
      >
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="block">
              <span className="label">Supplier / Batch</span>
              <input
                data-autofocus
                aria-label="Supplier / Batch"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Supplier name or batch number"
                className="input"
              />
            </label>
            <label className="block">
              <span className="label">Unit cost ({currency})</span>
              <input
                aria-label="Unit cost"
                inputMode="decimal"
                value={unitShown}
                onChange={(event) => setCost({ by: "unit", text: event.target.value })}
                placeholder="0.00"
                className={field}
              />
            </label>
            <label className="block">
              <span className="label">Total cost ({currency})</span>
              <input
                aria-label="Total cost"
                inputMode="decimal"
                value={totalShown}
                onChange={(event) => setCost({ by: "total", text: event.target.value })}
                placeholder="0.00"
                className={field}
              />
            </label>
          </div>

          {recordOnly ? (
            <div>
              <label className="block max-w-40">
                <span className="label">Units</span>
                <input
                  aria-label="Units"
                  inputMode="numeric"
                  value={plainUnits}
                  onChange={(event) => setPlainUnits(event.target.value)}
                  className={field}
                />
              </label>
              <p className="mt-2 text-xs text-stone-500">
                This is an older record without sizes and colors. Changing it corrects the record
                only; it does not add or remove stock.
              </p>
            </div>
          ) : (
            <div>
              <p className="label">Units by color and size</p>
              <div className="overflow-x-auto rounded-lg border border-stone-200">
                <table className="w-full border-collapse text-sm tabular-nums" data-batch-grid>
                  <thead>
                    <tr>
                      <th className="th w-36">Color</th>
                      {sizes.map((size) => (
                        <th key={size ?? "-"} className="th min-w-16 text-center">
                          {size ?? "One size"}
                        </th>
                      ))}
                      <th className="th w-20 text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {colors.map((color) => (
                      <tr key={color ?? "-"} className="border-b border-stone-100">
                        <th className="px-3 py-1.5 text-left font-semibold whitespace-nowrap">
                          <span className="flex items-center gap-2">
                            <span
                              className="size-3 shrink-0 rounded-sm border border-stone-300"
                              style={{ backgroundColor: colorDot(color) }}
                            />
                            {color ?? "—"}
                          </span>
                        </th>
                        {sizes.map((size) => {
                          const v = find(color, size);
                          if (!v) {
                            return (
                              <td key={size ?? "-"} className="px-2 py-1.5 text-center text-stone-300">
                                —
                              </td>
                            );
                          }
                          const after = v.stock + now(v) - was(v);
                          return (
                            <td key={v.id} className="px-1 py-1 text-center">
                              <input
                                inputMode="numeric"
                                aria-label={`${color ?? ""} ${size ?? ""}`.trim() || "Quantity"}
                                value={typed[v.id] ?? ""}
                                placeholder="0"
                                onChange={(event) =>
                                  setTyped((current) => ({ ...current, [v.id]: event.target.value }))
                                }
                                className={
                                  "input mx-auto w-16 px-1 py-1 text-center " +
                                  (after < 0 ? "border-rose-500 text-rose-700" : "")
                                }
                              />
                              <span
                                className={
                                  "mt-0.5 block text-[11px] " +
                                  (after < 0 ? "font-semibold text-rose-700" : "text-stone-400")
                                }
                              >
                                {after === v.stock ? `stock ${v.stock}` : `stock ${v.stock} → ${after}`}
                              </span>
                            </td>
                          );
                        })}
                        <td className="bg-stone-50 px-3 py-1.5 text-center font-bold">
                          {sum(variants.filter((v) => v.color === color))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-brand-100 font-bold">
                      <th className="px-3 py-2 text-left">Total</th>
                      {sizes.map((size) => (
                        <td key={size ?? "-"} className="px-2 py-2 text-center">
                          {sum(variants.filter((v) => v.size === size))}
                        </td>
                      ))}
                      <td className="bg-brand px-3 py-2 text-center text-white" data-batch-units>
                        {pieces}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                {batch
                  ? "Changing a number here changes the stock by the difference."
                  : "Saving adds these pieces to your stock."}
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm font-semibold text-rose-700">
              {error}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
          {batch && (
            <button
              type="button"
              disabled={pending}
              aria-label="Delete this batch"
              onClick={() => {
                const question = recordOnly
                  ? "Delete this purchase record? Stock will not change."
                  : `Delete this batch? Its ${batch.units} pieces will be taken out of stock.`;
                if (window.confirm(question)) onDelete();
              }}
              className="btn-secondary text-rose-700"
            >
              <Trash2 className="size-4" /> Delete
            </button>
          )}
          <p className="ml-auto text-sm tabular-nums" data-batch-summary>
            <b>{pieces}</b> {pieces === 1 ? "unit" : "units"}
            {unit !== null && total !== null && pieces > 0 && (
              <>
                {" "}
                × {formatMoney(unit, currency)} = <b>{formatMoney(total, currency)}</b>
              </>
            )}
          </p>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="btn px-5">
            {pending ? "Saving…" : batch ? "Save changes" : "Save batch"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
