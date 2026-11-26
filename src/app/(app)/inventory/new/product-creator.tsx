"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { MediaManager, type MediaItem } from "@/components/media-manager";
import { Block, Field } from "@/components/ui";
import { sortSizes } from "@/lib/format";
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
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2 py-1.5 focus-within:border-stone-900 focus-within:ring-1 focus-within:ring-stone-900">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-md bg-stone-900 py-0.5 pr-1 pl-2 text-xs font-medium text-white"
          >
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="size-4 cursor-pointer rounded text-stone-300 hover:bg-stone-700 hover:text-white"
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
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-stone-500">
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

export function ProductCreator({
  mode,
  offReason,
}: {
  mode: MediaMode;
  offReason: string | null;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [stock, setStock] = useState<Record<string, string>>({});
  const [fill, setFill] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [lowStockAt, setLowStockAt] = useState("5");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  // With no sizes (or colors) the product still has one column (or row).
  const columns: (string | null)[] = sizes.length ? sortSizes(sizes) : [null];
  const rows: (string | null)[] = colors.length ? colors : [null];
  const amountAt = (color: string | null, size: string | null) => {
    const n = Number(stock[cellKey(color, size)] ?? "");
    return Number.isInteger(n) && n >= 0 ? n : 0;
  };
  const rowTotal = (color: string | null) =>
    columns.reduce((sum, size) => sum + amountAt(color, size), 0);
  const columnTotal = (size: string | null) =>
    rows.reduce((sum, color) => sum + amountAt(color, size), 0);
  const total = rows.reduce((sum, color) => sum + rowTotal(color), 0);

  const save = () => {
    if (!name.trim()) return setError("Give the product a name.");
    const bad = Object.values(stock).some((value) => {
      const n = Number(value.trim() || "0");
      return !Number.isInteger(n) || n < 0;
    });
    if (bad) return setError("Stock must be whole numbers, 0 or more.");
    setError(null);
    startTransition(async () => {
      const result = await createProduct({
        name,
        category,
        description,
        price,
        cost,
        lowStockAt,
        variants: rows.flatMap((color) =>
          columns.map((size) => ({ size, color, stock: amountAt(color, size) })),
        ),
        media: media.map(({ url, kind, tag, fileName }) => ({ url, kind, tag, fileName })),
      });
      // On success the page moves to the new product, so only errors land here.
      if (result?.error) setError(result.error);
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-4">
          <Block title="Product">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Product name" className="sm:col-span-2">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Linen Shirt"
                  className="input py-1.5"
                />
              </Field>
              <Field label="Category (optional)">
                <input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="Shirts"
                  className="input py-1.5"
                />
              </Field>
              <Field label="Description (optional)">
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="input py-1.5"
                />
              </Field>
            </div>
          </Block>

          <Block title="Sizes & colors">
            <div className="grid gap-4 sm:grid-cols-2">
              <ChipInput
                label="Sizes"
                placeholder="Type a size, press Enter"
                values={sizes}
                ideas={SIZE_IDEAS}
                onChange={(next) => setSizes(sortSizes(next))}
              />
              <ChipInput
                label="Colors"
                placeholder="Type a color, press Enter"
                values={colors}
                ideas={COLOR_IDEAS}
                onChange={setColors}
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
                  className="input w-16 px-2 py-1 text-center text-xs"
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() =>
                    setStock(
                      Object.fromEntries(
                        rows.flatMap((color) =>
                          columns.map((size) => [cellKey(color, size), fill.trim()]),
                        ),
                      ),
                    )
                  }
                >
                  Fill all
                </button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-stone-200 text-xs text-stone-500">
                    <th className="w-36 px-4 py-2 text-left font-medium whitespace-nowrap">
                      Color ↓ / Size →
                    </th>
                    {columns.map((size) => (
                      <th
                        key={size ?? "-"}
                        className="min-w-16 px-2 py-2 text-center font-semibold text-stone-800"
                      >
                        {size ?? "One size"}
                      </th>
                    ))}
                    <th className="w-20 border-l border-stone-200 bg-stone-50 px-3 py-2 text-right font-medium">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((color) => (
                    <tr key={color ?? "-"} className="border-b border-stone-100">
                      <th className="px-4 py-1.5 text-left font-semibold whitespace-nowrap">
                        {color ?? "—"}
                      </th>
                      {columns.map((size) => (
                        <td key={size ?? "-"} className="px-1 py-1 text-center">
                          <input
                            inputMode="numeric"
                            aria-label={`${color ?? ""} ${size ?? ""}`.trim() || "Stock"}
                            placeholder="0"
                            value={stock[cellKey(color, size)] ?? ""}
                            onChange={(event) =>
                              setStock((current) => ({
                                ...current,
                                [cellKey(color, size)]: event.target.value,
                              }))
                            }
                            className="input mx-auto w-16 px-1 py-1 text-center"
                          />
                        </td>
                      ))}
                      <td className="border-l border-stone-200 bg-stone-50 px-3 py-2 text-right font-semibold">
                        {rowTotal(color)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-stone-50 font-semibold">
                    <th className="px-4 py-2 text-left">Total</th>
                    {columns.map((size) => (
                      <td key={size ?? "-"} className="px-2 py-2 text-center">
                        {columnTotal(size)}
                      </td>
                    ))}
                    <td className="border-l border-stone-200 bg-stone-900 px-3 py-2 text-right text-white">
                      {total}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Block>

          <Block title="Price">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Selling price">
                <input
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  inputMode="decimal"
                  className="input py-1.5"
                />
              </Field>
              <Field label="Your cost">
                <input
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  inputMode="decimal"
                  className="input py-1.5"
                />
              </Field>
              <Field label="Low stock alert">
                <input
                  value={lowStockAt}
                  onChange={(event) => setLowStockAt(event.target.value)}
                  inputMode="numeric"
                  className="input py-1.5"
                />
              </Field>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Every size and color starts with this price. You can set different
              prices for each one after saving.
            </p>
          </Block>
        </div>

        <div className="min-w-0">
          <MediaManager
            mode={mode}
            offReason={offReason}
            folder="products/new"
            items={media}
            onBusy={setUploading}
            onAdd={async (item) => {
              setMedia((current) => [...current, { ...item, id: item.url }]);
              return null;
            }}
            onTag={async (id, tag) => {
              setMedia((current) =>
                current.map((item) => (item.id === id ? { ...item, tag } : item)),
              );
              return null;
            }}
            onRemove={async (id) => {
              setMedia((current) => current.filter((item) => item.id !== id));
              return (await discardUpload(id))?.error;
            }}
          />
        </div>
      </div>

      <div className="card sticky bottom-3 z-10 flex flex-wrap items-center gap-3 px-4 py-3 shadow-sm">
        <p className="text-sm text-stone-600">
          {rows.length * columns.length} {rows.length * columns.length === 1 ? "item" : "items"} ·{" "}
          {total} units · {media.length} {media.length === 1 ? "file" : "files"}
        </p>
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        <span className="ml-auto flex items-center gap-3">
          <Link href="/inventory" className="text-sm text-stone-600 hover:underline">
            Cancel
          </Link>
          <button type="button" onClick={save} disabled={saving || uploading} className="btn">
            {saving ? "Saving…" : uploading ? "Uploading…" : "Save product"}
          </button>
        </span>
      </div>
    </div>
  );
}
