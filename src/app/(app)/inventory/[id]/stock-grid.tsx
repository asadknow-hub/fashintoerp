"use client";

import { startTransition, useActionState, useState } from "react";
import type { FormAction } from "@/components/action-form";
import { Block } from "@/components/ui";

export type GridVariant = {
  id: string;
  size: string | null;
  color: string | null;
  stock: number;
  lowStockAt: number;
};

const modes = {
  received: { button: "Receive stock", hint: "Type how many arrived of each." },
  recount: { button: "Recount", hint: "Type the exact number you counted." },
  damaged: { button: "Damaged / lost", hint: "Type how many to take off." },
} as const;
type Mode = keyof typeof modes;

// A spreadsheet-style view of stock: colors down the side, sizes across the
// top, totals on the right and bottom. Stock is edited right in the cells.
export function StockGrid({
  variants,
  sizes,
  colors,
  action,
}: {
  variants: GridVariant[];
  sizes: (string | null)[];
  colors: (string | null)[];
  action: FormAction;
}) {
  const [result, run, pending] = useActionState(action, null);
  const [seen, setSeen] = useState(result);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  // When a save comes back, close the editor in the same screen update that
  // brings the new numbers, so old totals never flash. On an error the typed
  // numbers stay put.
  if (result !== seen) {
    setSeen(result);
    setError(result?.error ?? null);
    if (!result?.error) setMode(null);
  }

  const start = (next: Mode) => {
    setTyped(
      next === "recount"
        ? Object.fromEntries(variants.map((v) => [v.id, String(v.stock)]))
        : {},
    );
    setNote("");
    setError(null);
    setMode(next);
  };

  // What the stock will be once the typed numbers are saved.
  const after = (v: GridVariant) => {
    const raw = typed[v.id]?.trim();
    const n = Number(raw);
    if (!mode || !raw || !Number.isInteger(n) || n < 0) return v.stock;
    if (mode === "recount") return n;
    return mode === "received" ? v.stock + n : v.stock - n;
  };

  const find = (color: string | null, size: string | null) =>
    variants.find((v) => v.color === color && v.size === size);
  const sum = (list: GridVariant[]) => list.reduce((total, v) => total + after(v), 0);
  const before = variants.reduce((total, v) => total + v.stock, 0);
  const total = sum(variants);

  const save = () => {
    if (!mode) return;
    const data = new FormData();
    data.set("kind", mode);
    data.set("note", note);
    for (const v of variants) {
      const raw = typed[v.id]?.trim();
      if (raw) data.set(`qty:${v.id}`, raw);
    }
    startTransition(() => run(data));
  };

  return (
    <Block
      title="Stock"
      flush
      aside={
        mode ? (
          <span className="text-xs text-stone-600">{modes[mode].hint}</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(modes) as Mode[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => start(key)}
                className="btn-secondary btn-sm"
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
              <th className="w-36 px-4 py-2 text-left font-medium whitespace-nowrap">
                Color ↓ / Size →
              </th>
              {sizes.map((size) => (
                <th key={size ?? "-"} className="min-w-16 px-2 py-2 text-center font-semibold text-stone-800">
                  {size ?? "One size"}
                </th>
              ))}
              <th className="w-20 border-l border-stone-200 bg-stone-50 px-3 py-2 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {colors.map((color) => (
              <tr key={color ?? "-"} className="border-b border-stone-100">
                <th className="px-4 py-1.5 text-left font-semibold whitespace-nowrap">
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
                        className={"px-2 py-2 text-center " + tone}
                      >
                        {v.stock}
                      </td>
                    );
                  }
                  const next = after(v);
                  return (
                    <td key={v.id} className="px-1 py-1 text-center">
                      <input
                        inputMode="numeric"
                        aria-label={`${color ?? ""} ${size ?? ""}`.trim() || "Quantity"}
                        value={typed[v.id] ?? ""}
                        placeholder={mode === "recount" ? "" : "0"}
                        onChange={(event) =>
                          setTyped((current) => ({ ...current, [v.id]: event.target.value }))
                        }
                        className={
                          "input mx-auto w-16 px-1 py-1 text-center " +
                          (next < 0 ? "border-rose-500 text-rose-700" : "")
                        }
                      />
                      <span className="mt-0.5 block text-[11px] text-stone-400">
                        {next === v.stock ? `has ${v.stock}` : `${v.stock} → ${next}`}
                      </span>
                    </td>
                  );
                })}
                <td className="border-l border-stone-200 bg-stone-50 px-3 py-2 text-right font-semibold">
                  {sum(variants.filter((v) => v.color === color))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-stone-50 font-semibold">
              <th className="px-4 py-2 text-left">Total</th>
              {sizes.map((size) => (
                <td key={size ?? "-"} className="px-2 py-2 text-center">
                  {sum(variants.filter((v) => v.size === size))}
                </td>
              ))}
              <td className="border-l border-stone-200 bg-stone-900 px-3 py-2 text-right text-white">
                {total}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {mode && (
        <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 px-4 py-3">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
            className="input max-w-xs flex-1 py-1.5"
          />
          <span className="text-xs text-stone-500">
            {total === before
              ? "No change yet"
              : `Total ${before} → ${total} (${total > before ? "+" : ""}${total - before})`}
          </span>
          <span className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode(null);
              }}
              className="btn-secondary btn-sm"
            >
              Cancel
            </button>
            <button type="button" onClick={save} disabled={pending} className="btn btn-sm">
              {pending ? "Saving…" : "Save stock"}
            </button>
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="border-t border-stone-200 px-4 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
    </Block>
  );
}
