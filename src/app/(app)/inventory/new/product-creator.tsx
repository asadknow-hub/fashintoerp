"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { MediaManager, type MediaItem } from "@/components/media-manager";
import { Block, Field } from "@/components/ui";
import { formatMoney, sortSizes } from "@/lib/format";
import type { MediaMode } from "@/lib/media-rules";
import { createProduct, discardUpload } from "../actions";

const SIZE_IDEAS = ["XS", "S", "M", "L", "XL", "XXL"];
const COLOR_IDEAS = ["Black", "White", "Beige", "Navy", "Grey", "Brown"];

const has = (list: string[], value: string) =>
  list.some((item) => item.toLowerCase() === value.toLowerCase());

// A box where each size or color becomes its own removable chip.
function ChipInput({
  label,
  placeholder,
  values,
  ideas,
  onChange,
}: {
  label: string;
  placeholder: string;
  values: string[];
  ideas: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const fresh = raw
      .split(",")
      .map((part) => part.trim().replace(/\s+/g, " ").slice(0, 40))
      .filter(Boolean);
    const next = [...values];
    for (const value of fresh) if (!has(next, value)) next.push(value);
    if (next.length !== values.length) onChange(next);
    setDraft("");
  };

  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-stone-300 bg-white px-1.5 py-1 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-md bg-brand py-0.5 pr-1 pl-2 text-xs font-medium text-white"
          >
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="size-4 cursor-pointer rounded text-stone-300 hover:bg-brand-700 hover:text-white"
            >
              ×
            </button>
          </span>
        ))}
        <input
          aria-label={label}
          value={draft}
          placeholder={values.length ? "" : placeholder}
          onChange={(event) =>
            event.target.value.includes(",") ? add(event.target.value) : setDraft(event.target.value)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add(draft);
            } else if (event.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-stone-400"
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-stone-500">
        Quick add:
        {ideas.map((idea) => (
          <button
            key={idea}
            type="button"
            disabled={has(values, idea)}
            onClick={() => add(idea)}
            className="cursor-pointer rounded border border-stone-300 bg-white px-1.5 py-0.5 text-stone-700 hover:bg-stone-100 disabled:cursor-default disabled:opacity-40"
          >
            {idea}
          </button>
        ))}
      </div>
    </div>
  );
}

const cellKey = (color: string | null, size: string | null) => JSON.stringify([color, size]);

/* ---------- Draft: what has been typed survives a refresh ---------- */

const DRAFT_KEY = "fashinto:new-product";

type Draft = {
  name: string;
  category: string;
  description: string;
  sizes: string[];
  colors: string[];
  stock: Record<string, string>;
  price: string;
  cost: string;
  lowStockAt: string;
  totalPaid: string;
  media: MediaItem[];
};

const EMPTY: Draft = {
  name: "",
  category: "",
  description: "",
  sizes: [],
  colors: [],
  stock: {},
  price: "",
  cost: "",
  lowStockAt: "5",
  totalPaid: "",
  media: [],
};

function readDraft(): Draft | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return null;
    const draft = { ...EMPTY, ...saved } as Draft;
    if (!Array.isArray(draft.sizes) || !Array.isArray(draft.colors)) return null;
    if (!Array.isArray(draft.media)) return null;
    return draft;
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft | null) {
  try {
    if (draft) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage can be blocked (private windows); the form still works without it.
  }
}

const started = (draft: Draft) =>
  !!(draft.name || draft.category || draft.sizes.length || draft.colors.length || draft.media.length);

const never = () => () => {};

// The draft lives in the browser, so the editor is only drawn there.
export function ProductCreator(props: {
  mode: MediaMode;
  offReason: string | null;
  currency: string;
}) {
  const inBrowser = useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
  return inBrowser ? <Editor {...props} /> : <div className="card h-96 animate-pulse" />;
}

function Editor({
  mode,
  offReason,
  currency,
}: {
  mode: MediaMode;
  offReason: string | null;
  currency: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Draft>(() => readDraft() ?? EMPTY);
  const [restored, setRestored] = useState(() => started(form));
  const [fill, setFill] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const set = (change: Partial<Draft>) => setForm((current) => ({ ...current, ...change }));

  // Keep a copy of everything typed, so a refresh doesn't lose it.
  useEffect(() => {
    writeDraft(started(form) ? form : null);
  }, [form]);

  // With no sizes (or colors) the product still has one column (or row).
  const columns: (string | null)[] = form.sizes.length ? sortSizes(form.sizes) : [null];
  const rows: (string | null)[] = form.colors.length ? form.colors : [null];
  const amountAt = (color: string | null, size: string | null) => {
    const n = Number(form.stock[cellKey(color, size)] ?? "");
    return Number.isInteger(n) && n >= 0 ? n : 0;
  };
  const rowTotal = (color: string | null) =>
    columns.reduce((sum, size) => sum + amountAt(color, size), 0);
  const columnTotal = (size: string | null) =>
    rows.reduce((sum, color) => sum + amountAt(color, size), 0);
  const total = rows.reduce((sum, color) => sum + rowTotal(color), 0);
  const count = rows.length * columns.length;

  const startOver = async () => {
    const files = form.media;
    setForm(EMPTY);
    setRestored(false);
    setError(null);
    writeDraft(null);
    await Promise.all(files.map((item) => discardUpload(item.url, item.thumbUrl)));
  };

  const save = () => {
    if (!form.name.trim()) return setError("Give the product a name.");
    const bad = Object.values(form.stock).some((value) => {
      const n = Number(value.trim() || "0");
      return !Number.isInteger(n) || n < 0;
    });
    if (bad) return setError("Stock must be whole numbers, 0 or more.");
    setError(null);
    startTransition(async () => {
      const result = await createProduct({
        name: form.name,
        category: form.category,
        description: form.description,
        price: form.price,
        cost: form.cost,
        lowStockAt: form.lowStockAt,
        totalPaid: form.totalPaid,
        variants: rows.flatMap((color) =>
          columns.map((size) => ({ size, color, stock: amountAt(color, size) })),
        ),
        media: form.media.map(({ url, thumbUrl, kind, tag, fileName }) => ({
          url,
          thumbUrl,
          kind,
          tag,
          fileName,
        })),
      });
      if ("error" in result) return setError(result.error);
      // Saved: clear the form and its draft, then open the new product.
      setForm(EMPTY);
      setRestored(false);
      writeDraft(null);
      router.push(`/inventory/${result.id}`);
    });
  };

  return (
    <div className="space-y-3">
      {restored && (
        <p className="card flex flex-wrap items-center gap-2 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
          You have an unsaved product from before. It&apos;s all still here.
          <button type="button" onClick={startOver} className="cursor-pointer font-semibold underline">
            Start over instead
          </button>
        </p>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_19rem] 2xl:grid-cols-[19rem_minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-3 lg:col-start-1 lg:row-span-2 lg:row-start-1 2xl:col-start-2 2xl:row-span-1">
          <Block title="Product">
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
              <Field label="Product name">
                <input
                  value={form.name}
                  onChange={(event) => set({ name: event.target.value })}
                  placeholder="Linen Shirt"
                  className="input"
                />
              </Field>
              <Field label="Category (optional)">
                <input
                  value={form.category}
                  onChange={(event) => set({ category: event.target.value })}
                  placeholder="Shirts"
                  className="input"
                />
              </Field>
              <Field label="Description (optional)" className="sm:col-span-2">
                <input
                  value={form.description}
                  onChange={(event) => set({ description: event.target.value })}
                  className="input"
                />
              </Field>
            </div>
          </Block>

          <Block title="Sizes & colors">
            <div className="grid gap-3 sm:grid-cols-2">
              <ChipInput
                label="Sizes"
                placeholder="Type a size, press Enter"
                values={form.sizes}
                ideas={SIZE_IDEAS}
                onChange={(next) => set({ sizes: sortSizes(next) })}
              />
              <ChipInput
                label="Colors"
                placeholder="Type a color, press Enter"
                values={form.colors}
                ideas={COLOR_IDEAS}
                onChange={(next) => set({ colors: next })}
              />
            </div>
          </Block>

          <Block
            title="Opening stock"
            flush
            aside={
              <div className="flex items-center gap-1.5">
                <input
                  value={fill}
                  onChange={(event) => setFill(event.target.value)}
                  inputMode="numeric"
                  placeholder="0"
                  aria-label="Stock for every box"
                  className="input w-14 px-2 py-0.5 text-center text-xs"
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() =>
                    set({
                      stock: Object.fromEntries(
                        rows.flatMap((color) =>
                          columns.map((size) => [cellKey(color, size), fill.trim()]),
                        ),
                      ),
                    })
                  }
                >
                  Fill all
                </button>
              </div>
            }
          >
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead>
                  <tr>
                    <th className="th w-36 rounded-l-lg">Color</th>
                    {columns.map((size) => (
                      <th
                        key={size ?? "-"}
                        className="th min-w-14 text-center"
                      >
                        {size ?? "One size"}
                      </th>
                    ))}
                    <th className="th w-20 rounded-r-lg text-center">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((color) => (
                    <tr key={color ?? "-"} className="border-b border-stone-100">
                      <th className="px-3 py-1 text-left font-semibold whitespace-nowrap">
                        {color ?? "—"}
                      </th>
                      {columns.map((size) => (
                        <td key={size ?? "-"} className="px-1 py-0.5 text-center">
                          <input
                            inputMode="numeric"
                            aria-label={`${color ?? ""} ${size ?? ""}`.trim() || "Stock"}
                            placeholder="0"
                            value={form.stock[cellKey(color, size)] ?? ""}
                            onChange={(event) =>
                              set({
                                stock: { ...form.stock, [cellKey(color, size)]: event.target.value },
                              })
                            }
                            className="input mx-auto w-14 px-1 py-0.5 text-center"
                          />
                        </td>
                      ))}
                      <td className="bg-stone-50 px-3 py-1.5 text-center font-bold">
                        {rowTotal(color)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-brand-100 font-bold">
                    <th className="rounded-l-lg px-3 py-2 text-left">Total</th>
                    {columns.map((size) => (
                      <td key={size ?? "-"} className="px-2 py-1.5 text-center">
                        {columnTotal(size)}
                      </td>
                    ))}
                    <td className="rounded-r-lg bg-brand px-3 py-2 text-center text-white">
                      {total}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Block>
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-start-1 2xl:col-start-1">
          <Block title="Photos & videos">
            <MediaManager
              mode={mode}
              offReason={offReason}
              folder="products/new"
              items={form.media}
              onBusy={setUploading}
              onAdd={async (item) => {
                setForm((current) => ({
                  ...current,
                  media: [...current.media, { ...item, id: item.url }],
                }));
                return null;
              }}
              onTag={async (id, tag) => {
                setForm((current) => ({
                  ...current,
                  media: current.media.map((item) => (item.id === id ? { ...item, tag } : item)),
                }));
                return null;
              }}
              onRemove={async (id) => {
                const gone = form.media.find((item) => item.id === id);
                setForm((current) => ({
                  ...current,
                  media: current.media.filter((item) => item.id !== id),
                }));
                return gone ? (await discardUpload(gone.url, gone.thumbUrl))?.error : null;
              }}
            />
          </Block>
        </div>

        <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-start-2 2xl:col-start-3 2xl:row-start-1">
          <Block title="Price">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Selling price">
                <input
                  value={form.price}
                  onChange={(event) => set({ price: event.target.value })}
                  inputMode="decimal"
                  className="input"
                />
              </Field>
              <Field label="Your cost">
                <input
                  value={form.cost}
                  onChange={(event) => set({ cost: event.target.value })}
                  inputMode="decimal"
                  className="input"
                />
              </Field>
              <Field label="Alert at">
                <input
                  value={form.lowStockAt}
                  onChange={(event) => set({ lowStockAt: event.target.value })}
                  inputMode="numeric"
                  className="input"
                />
              </Field>
            </div>
            <Field
              label="Total paid for all this stock (optional)"
              className="mt-2"
              hint={
                Number(form.totalPaid) > 0 && total > 0
                  ? `${formatMoney(Number(form.totalPaid) / total, currency)} per piece for ${total} pieces${
                      form.cost.trim() ? "" : " — used as your cost"
                    }`
                  : "What you paid for the whole lot. If you leave “Your cost” empty, it is worked out from this."
              }
            >
              <input
                value={form.totalPaid}
                onChange={(event) => set({ totalPaid: event.target.value })}
                inputMode="decimal"
                aria-label="Total paid for all this stock"
                className="input"
              />
            </Field>
            <p className="mt-1.5 text-[11px] leading-snug text-stone-500">
              Every size and color starts with this price. You can set different
              prices for each one after saving.
            </p>
          </Block>

          <Block title="Save">
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded border border-stone-300 bg-stone-300 text-center">
              {[
                ["Items", count],
                ["Units", total],
                ["Files", form.media.length],
              ].map(([label, value]) => (
                <div key={label} className="bg-white py-1">
                  <dt className="text-[11px] text-stone-500">{label}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {error && (
              <p role="alert" className="mt-2 text-xs text-rose-700">
                {error}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving || uploading}
                className="btn flex-1"
              >
                {saving ? "Saving…" : uploading ? "Uploading…" : "Save product"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  await startOver();
                  router.push("/inventory");
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </Block>
        </div>
      </div>
    </div>
  );
}
