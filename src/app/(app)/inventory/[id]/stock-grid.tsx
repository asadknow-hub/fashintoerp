"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import type { ActionState } from "@/components/action-form";
import { Block } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { adjustStockGrid, applyCount, deleteCount, saveCount } from "../actions";

export type GridVariant = {
  id: string;
  size: string | null;
  color: string | null;
  stock: number;
  lowStockAt: number;
};

// A saved fresh count: what was counted, next to what the system had then.
export type CountSnapshot = {
  id: string;
  note: string | null;
  when: string;
  by: string | null;
  applied: string | null;
  lines: { variantId: string; counted: number; system: number }[];
};

const modes = {
  count: {
    button: "Fresh count",
    hint: "Type what you counted. It is saved as a snapshot and does not change stock.",
    save: "Save count",
  },
  received: { button: "Receive stock", hint: "Type how many arrived of each.", save: "Save stock" },
  damaged: { button: "Damaged / lost", hint: "Type how many to take off.", save: "Save stock" },
} as const;
type Mode = keyof typeof modes;

const gap = (missing: number, extra: number) =>
  [missing ? `${missing} missing` : null, extra ? `${extra} extra` : null]
    .filter(Boolean)
    .join(" · ") || "all match";

// A spreadsheet-style view of stock: colors down the side, sizes across the
// top, totals on the right and bottom. Stock is edited right in the cells,
// and fresh counts are kept underneath as snapshots.
export function StockGrid({
  productId,
  variants,
  sizes,
  colors,
  counts,
  currency,
}: {
  productId: string;
  variants: GridVariant[];
  sizes: (string | null)[];
  colors: (string | null)[];
  counts: CountSnapshot[];
  currency: string;
}) {
  // One save path for all three modes, so the editor always closes in the
  // same screen update that brings the fresh numbers.
  const [result, run, pending] = useActionState(
    (state: ActionState, form: FormData) =>
      form.get("kind") === "count"
        ? saveCount(productId, state, form)
        : adjustStockGrid(productId, state, form),
    null,
  );
  const [seen, setSeen] = useState(result);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  // What a delivery cost in total; only asked for when receiving stock.
  const [paid, setPaid] = useState("");
  // The snapshot being edited, if any.
  const [editing, setEditing] = useState<CountSnapshot | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [working, startWork] = useTransition();

  if (result !== seen) {
    setSeen(result);
    setError(result?.error ?? null);
    setNotice(result?.ok ?? null);
    // On an error the typed numbers stay put.
    if (!result?.error) {
      setMode(null);
      setEditing(null);
    }
  }

  const start = (next: Mode, snapshot: CountSnapshot | null = null) => {
    // A fresh count starts with empty boxes: you type what you see, not what
    // the system already believes. Editing brings back what was typed before.
    setTyped(
      snapshot
        ? Object.fromEntries(snapshot.lines.map((line) => [line.variantId, String(line.counted)]))
        : {},
    );
    setNote(snapshot?.note ?? "");
    setPaid("");
    setEditing(snapshot);
    setError(null);
    setNotice(null);
    setMode(next);
  };

  const typedNumber = (v: GridVariant) => {
    const raw = typed[v.id]?.trim();
    const n = Number(raw);
    return raw && Number.isInteger(n) && n >= 0 ? n : null;
  };

  // What a count is compared with: the system's number when it was first
  // counted (kept while editing), otherwise what the system has now.
  const baseline = (v: GridVariant) =>
    editing?.lines.find((line) => line.variantId === v.id)?.system ?? v.stock;

  // What the stock will be once saved. A count never changes it.
  const after = (v: GridVariant) => {
    const n = typedNumber(v);
    if (n === null || mode === null || mode === "count") return v.stock;
    return mode === "received" ? v.stock + n : v.stock - n;
  };

  const find = (color: string | null, size: string | null) =>
    variants.find((v) => v.color === color && v.size === size);
  const sum = (list: GridVariant[]) => list.reduce((total, v) => total + after(v), 0);
  const before = variants.reduce((total, v) => total + v.stock, 0);
  const total = sum(variants);

  const counted = variants.filter((v) => typedNumber(v) !== null);
  const expected = counted.reduce((sum, v) => sum + baseline(v), 0);
  const found = counted.reduce((sum, v) => sum + typedNumber(v)!, 0);
  const missing = counted.reduce((sum, v) => sum + Math.max(0, baseline(v) - typedNumber(v)!), 0);
  const extra = counted.reduce((sum, v) => sum + Math.max(0, typedNumber(v)! - baseline(v)), 0);

  const save = () => {
    if (!mode) return;
    const data = new FormData();
    data.set("kind", mode);
    data.set("note", note);
    if (mode === "received") data.set("totalPaid", paid.trim());
    if (editing) data.set("countId", editing.id);
    for (const v of variants) {
      const raw = typed[v.id]?.trim();
      if (raw) data.set(`qty:${v.id}`, raw);
    }
    startTransition(() => run(data));
  };

  const act = (work: () => Promise<ActionState>) =>
    startWork(async () => {
      const outcome = await work();
      // Shown together with the refreshed numbers, not a moment before them.
      startTransition(() => {
        setError(outcome?.error ?? null);
        setNotice(outcome?.ok ?? null);
      });
    });

  const th = "px-2 py-1.5 text-center font-semibold text-stone-800";

  return (
    <Block
      title="Stock"
      flush
      aside={
        mode ? (
          <span className="text-xs text-stone-600">
            {editing ? `Editing the count from ${editing.when}. ` : ""}
            {modes[mode].hint}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(modes) as Mode[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => start(key)}
                className={key === "count" ? "btn btn-sm" : "btn-secondary btn-sm"}
              >
                {modes[key].button}
              </button>
            ))}
          </div>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr className="border-b border-stone-200 text-xs text-stone-500">
              <th className="w-32 px-3 py-1.5 text-left font-medium whitespace-nowrap">
                Color ↓ / Size →
              </th>
              {sizes.map((size) => (
                <th key={size ?? "-"} className={"min-w-14 " + th}>
                  {size ?? "One size"}
                </th>
              ))}
              <th className="w-20 border-l border-stone-300 bg-stone-50 px-3 py-1.5 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {colors.map((color) => (
              <tr key={color ?? "-"} className="border-b border-stone-100">
                <th className="px-3 py-1 text-left font-semibold whitespace-nowrap">
                  {color ?? "—"}
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
                  if (!mode) {
                    const tone =
                      v.stock <= 0
                        ? "bg-rose-50 font-semibold text-rose-700"
                        : v.stock <= v.lowStockAt
                          ? "bg-amber-50 font-semibold text-amber-800"
                          : "";
                    return (
                      <td
                        key={v.id}
                        title={
                          v.stock <= 0
                            ? "Out of stock"
                            : v.stock <= v.lowStockAt
                              ? "Running low"
                              : undefined
                        }
                        className={"border-l border-stone-100 px-2 py-1.5 text-center " + tone}
                      >
                        {v.stock}
                      </td>
                    );
                  }
                  const next = after(v);
                  const n = typedNumber(v);
                  const base = baseline(v);
                  return (
                    <td key={v.id} className="px-1 py-1 text-center">
                      <input
                        inputMode="numeric"
                        aria-label={`${color ?? ""} ${size ?? ""}`.trim() || "Quantity"}
                        value={typed[v.id] ?? ""}
                        placeholder={mode === "count" ? "?" : "0"}
                        onChange={(event) =>
                          setTyped((current) => ({ ...current, [v.id]: event.target.value }))
                        }
                        className={
                          "input mx-auto w-16 px-1 py-1 text-center " +
                          (next < 0 ? "border-rose-500 text-rose-700" : "")
                        }
                      />
                      {mode === "count" ? (
                        <span
                          className={
                            "mt-0.5 block text-[11px] " +
                            (n === null
                              ? "text-stone-400"
                              : n < base
                                ? "font-semibold text-rose-700"
                                : n > base
                                  ? "font-semibold text-emerald-700"
                                  : "text-stone-500")
                          }
                        >
                          {n === null
                            ? `system ${base}`
                            : n === base
                              ? `${base} ✓ matches`
                              : n < base
                                ? `system ${base} · ${base - n} missing`
                                : `system ${base} · ${n - base} extra`}
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[11px] text-stone-400">
                          {next === v.stock ? `has ${v.stock}` : `${v.stock} → ${next}`}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="border-l border-stone-300 bg-stone-50 px-3 py-1.5 text-right font-semibold">
                  {sum(variants.filter((v) => v.color === color))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-stone-50 font-semibold">
              <th className="px-3 py-1.5 text-left">Total</th>
              {sizes.map((size) => (
                <td key={size ?? "-"} className="px-2 py-1.5 text-center">
                  {sum(variants.filter((v) => v.size === size))}
                </td>
              ))}
              <td className="border-l border-stone-300 bg-stone-900 px-3 py-1.5 text-right text-white">
                {total}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {mode && (
        <div className="flex flex-wrap items-center gap-2 border-t border-stone-300 px-3 py-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
            className="input max-w-xs flex-1 py-1.5"
          />
          {mode === "received" && (
            <input
              value={paid}
              onChange={(event) => setPaid(event.target.value)}
              inputMode="decimal"
              placeholder="Total paid (optional)"
              aria-label="Total paid"
              className="input w-44 py-1.5"
            />
          )}
          {mode === "count" ? (
            <span data-count-summary className="text-xs text-stone-700">
              {counted.length === 0 ? (
                "Nothing counted yet"
              ) : (
                <>
                  Counted {counted.length} of {variants.length} · system had{" "}
                  <b>{expected}</b>, you counted <b>{found}</b>
                  {missing > 0 && <b className="text-rose-700"> · {missing} missing</b>}
                  {extra > 0 && <b className="text-emerald-700"> · {extra} extra</b>}
                  {missing === 0 && extra === 0 && " · all match"}
                </>
              )}
            </span>
          ) : (
            <span className="text-xs text-stone-500">
              {total === before
                ? "No change yet"
                : `Total ${before} → ${total} (${total > before ? "+" : ""}${total - before})`}
              {mode === "received" && Number(paid) > 0 && total > before && (
                <b className="text-stone-700">
                  {" "}
                  · {formatMoney(Number(paid) / (total - before), currency)} per piece
                </b>
              )}
            </span>
          )}
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode(null);
                setEditing(null);
              }}
              className="btn-secondary btn-sm"
            >
              Cancel
            </button>
            <button type="button" onClick={save} disabled={pending} className="btn btn-sm">
              {pending ? "Saving…" : editing ? "Save changes" : modes[mode].save}
            </button>
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="border-t border-stone-200 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      {notice && !mode && (
        <p role="status" className="border-t border-stone-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {counts.length > 0 && !mode && (
        <div className="border-t border-stone-300" data-count-list>
          <h3 className="bg-stone-50 px-3 py-1 text-[11px] font-bold tracking-wider text-stone-600 uppercase">
            Count snapshots
            <span className="ml-2 font-normal tracking-normal normal-case">
              For reference only. They don&apos;t change stock, and deleting one changes nothing.
            </span>
          </h3>
          <ul className="divide-y divide-stone-100">
            {counts.map((count) => {
              const sumOf = (pick: (line: CountSnapshot["lines"][number]) => number) =>
                count.lines.reduce((sum, line) => sum + pick(line), 0);
              const stockNow = (line: CountSnapshot["lines"][number]) =>
                variants.find((v) => v.id === line.variantId)?.stock ?? line.system;
              const then = gap(
                sumOf((line) => Math.max(0, line.system - line.counted)),
                sumOf((line) => Math.max(0, line.counted - line.system)),
              );
              const now = gap(
                sumOf((line) => Math.max(0, stockNow(line) - line.counted)),
                sumOf((line) => Math.max(0, line.counted - stockNow(line))),
              );
              const open = openId === count.id;
              return (
                <li key={count.id} data-count className="px-3 py-1.5 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{count.when}</span>
                    {count.by && <span className="text-xs text-stone-500">{count.by}</span>}
                    {count.note && <span className="text-xs text-stone-600">“{count.note}”</span>}
                    {count.applied && (
                      <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-medium">
                        Used as stock {count.applied}
                      </span>
                    )}
                    <span className="ml-auto flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : count.id)}
                        className="btn-secondary btn-sm"
                      >
                        {open ? "Hide" : "View"}
                      </button>
                      {!count.applied && (
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => start("count", count)}
                          className="btn-secondary btn-sm"
                        >
                          Edit
                        </button>
                      )}
                      {!count.applied && (
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => {
                            if (
                              window.confirm(
                                "This changes the real stock to match this count. Only do this if the count is the truth and no orders for these items are still to be entered. Continue?",
                              )
                            ) {
                              act(() => applyCount(count.id));
                            }
                          }}
                          className="btn-secondary btn-sm"
                        >
                          Use as stock
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => {
                          if (window.confirm("Delete this count? Stock will not change.")) {
                            act(() => deleteCount(count.id));
                          }
                        }}
                        className="btn-secondary btn-sm text-rose-700"
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 tabular-nums">
                    Counted <b>{sumOf((line) => line.counted)}</b> · system had{" "}
                    <b>{sumOf((line) => line.system)}</b> then ({then}) · system has{" "}
                    <b>{sumOf(stockNow)}</b> now ({now})
                  </p>

                  {open && (
                    <div className="mt-1.5 overflow-x-auto rounded border border-stone-200">
                      <table className="w-full border-collapse text-xs tabular-nums">
                        <thead>
                          <tr className="border-b border-stone-200 text-stone-500">
                            <th className="px-2 py-1 text-left font-medium">Counted (system then)</th>
                            {sizes.map((size) => (
                              <th key={size ?? "-"} className="px-2 py-1 text-center font-semibold">
                                {size ?? "One size"}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {colors.map((color) => (
                            <tr key={color ?? "-"} className="border-b border-stone-100 last:border-0">
                              <th className="px-2 py-1 text-left font-semibold">{color ?? "—"}</th>
                              {sizes.map((size) => {
                                const v = find(color, size);
                                const line = v && count.lines.find((l) => l.variantId === v.id);
                                return (
                                  <td
                                    key={size ?? "-"}
                                    className={
                                      "px-2 py-1 text-center " +
                                      (!line
                                        ? "text-stone-300"
                                        : line.counted < line.system
                                          ? "bg-rose-50 text-rose-800"
                                          : line.counted > line.system
                                            ? "bg-emerald-50 text-emerald-800"
                                            : "")
                                    }
                                  >
                                    {line ? (
                                      <>
                                        <b>{line.counted}</b>{" "}
                                        <span className="text-stone-500">({line.system})</span>
                                      </>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Block>
  );
}
