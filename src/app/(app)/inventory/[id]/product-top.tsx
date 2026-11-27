"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  Coins,
  Layers,
  Package,
  Plus,
  Tag,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  startTransition,
  useActionState,
  useState,
  useTransition,
} from "react";
import type { MediaItem } from "@/components/media-manager";
import { Badge } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { offerTotal, pieceCost } from "@/lib/offer";
import type { MediaMode } from "@/lib/media-rules";
import { setArchived, updateProduct } from "../actions";
import { MediaBlock } from "./media-block";

const NEW = "__new__";

// What 1, 2, 3 and 4 pieces cost together. The price for 4 also sets what
// each piece after the fourth adds.
const priceRows = [
  { key: "price", pieces: 1, label: "1 piece", nth: "1st" },
  { key: "price2", pieces: 2, label: "2 pieces", nth: "2nd" },
  { key: "price3", pieces: 3, label: "3 pieces", nth: "3rd" },
  { key: "price4", pieces: 4, label: "4+ pieces", nth: "4th" },
] as const;

// A typed amount as a number, or null while the box is empty or not a number.
const typedAmount = (text: string) => {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(value) && value >= 0 ? value : null;
};

type Values = {
  name: string;
  description: string;
  category: string;
  sku: string;
  price: string;
  price2: string;
  price3: string;
  price4: string;
};

// Two ways of typing the same thing ("80" and "80.00", "abc" and "ABC")
// should not count as a change.
const same = (key: keyof Values, a: string, b: string) => {
  const [x, y] = [a.trim(), b.trim()];
  if (key === "sku") return x.toUpperCase() === y.toUpperCase();
  if (key.startsWith("price") && x !== "" && y !== "") {
    const [m, n] = [Number(x), Number(y)];
    if (Number.isFinite(m) && Number.isFinite(n)) return m === n;
  }
  return x === y;
};

// The top of the product page: its name and main buttons, the photo gallery,
// and the "Product Information" card. Save stores everything in that card.
export function ProductTop({
  product,
  categories,
  price,
  tiers,
  currency,
  metrics,
  media,
  mode,
  offReason,
}: {
  product: {
    id: string;
    name: string;
    description: string | null;
    category: string | null;
    sku: string | null;
    archived: boolean;
  };
  categories: string[];
  // The selling price shared by every size and color, or a note that they differ.
  price: { value: string; varies: boolean };
  // Price per piece for 2, 3, and 4 or more pieces; empty when not set.
  tiers: { price2: string; price3: string; price4: string };
  currency: string;
  metrics: { averageCost: string; available: string; purchasedValue: string };
  media: MediaItem[];
  mode: MediaMode;
  offReason: string | null;
}) {
  const [state, save, saving] = useActionState(
    updateProduct.bind(null, product.id),
    null,
  );
  // What is saved right now, next to what is typed. Save only lights up
  // when the two differ.
  const saved: Values = {
    name: product.name,
    description: product.description ?? "",
    category: product.category ?? "",
    sku: product.sku ?? "",
    price: price.value,
    ...tiers,
  };
  const savedKey = JSON.stringify(saved);
  const [seenKey, setSeenKey] = useState(savedKey);
  const [values, setValues] = useState(saved);
  if (savedKey !== seenKey) {
    // Fresh saved values arrived (after a save): show exactly those.
    setSeenKey(savedKey);
    setValues(saved);
  }
  const set = (change: Partial<Values>) =>
    setValues((current) => ({ ...current, ...change }));
  const changed = (Object.keys(saved) as (keyof Values)[]).some(
    (key) => !same(key, values[key], saved[key]),
  );
  const category = values.category;
  const setCategory = (value: string) => set({ category: value });
  const [archiving, startArchive] = useTransition();
  const options = [...new Set([...categories, category].filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );

  const receive = () => {
    // The stock grid further down listens for this and opens its "receive" boxes.
    window.dispatchEvent(new Event("stock:receive"));
    document
      .getElementById("variants")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const box =
    "flex h-9 w-full items-center rounded-lg border px-3 text-sm font-semibold tabular-nums";
  const plain = box + " border-stone-200 bg-white";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!changed || saving) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => save(data));
      }}
      className="space-y-3"
    >
      <div>
        <Link
          href="/products"
          className="inline-flex items-center gap-2 text-xs font-medium text-stone-500 hover:text-brand"
        >
          <ArrowLeft className="size-3.5" /> Products
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href="/products"
            aria-label="Back to products"
            className="text-stone-700 hover:text-brand"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="min-w-0 truncate text-xl font-extrabold tracking-tight">
            {product.name}
          </h1>
          {product.archived && <Badge>Archived</Badge>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {state?.error && changed && !saving && (
              <span
                role="alert"
                className="text-xs font-semibold text-rose-700"
              >
                {state.error}
              </span>
            )}
            {changed && !saving && !state?.error && (
              <span
                data-unsaved
                className="text-xs font-semibold text-amber-700"
              >
                Unsaved changes
              </span>
            )}
            {state?.ok && !saving && !changed && (
              <span
                role="status"
                className="text-xs font-semibold text-emerald-700"
              >
                {state.ok}
              </span>
            )}
            <button
              type="button"
              disabled={archiving}
              onClick={() =>
                startArchive(async () => {
                  await setArchived(product.id, !product.archived);
                })
              }
              className="btn-secondary"
            >
              {product.archived ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
              {archiving
                ? "Working…"
                : product.archived
                  ? "Restore Product"
                  : "Archive Product"}
            </button>
            <button type="button" onClick={receive} className="btn-secondary">
              <Plus className="size-4" /> Receive Stock
            </button>
            {changed && !saving && (
              <button
                type="button"
                onClick={() => setValues(saved)}
                title="Put everything back as it was saved"
                className="btn-secondary"
              >
                <X className="size-4" /> Discard
              </button>
            )}
            <button
              type="submit"
              disabled={saving || !changed}
              title={changed ? undefined : "Nothing to save yet"}
              className="btn px-5 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500 disabled:opacity-100"
            >
              <Check className="size-4" /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <MediaBlock
          productId={product.id}
          items={media}
          mode={mode}
          offReason={offReason}
        />

        <section className="card p-4" data-product-info>
          <h2 className="mb-3 text-sm font-bold">Product Information</h2>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="space-y-2.5">
              <label className="block">
                <span className="label">
                  Name <span className="text-rose-600">*</span>
                </span>
                <input
                  name="name"
                  required
                  value={values.name}
                  onChange={(event) => set({ name: event.target.value })}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="label">Description</span>
                <textarea
                  name="description"
                  rows={2}
                  value={values.description}
                  onChange={(event) => set({ description: event.target.value })}
                  placeholder="Enter product description…"
                  className="input resize-y"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="label">Category</span>
                  <input type="hidden" name="category" value={category} />
                  <select
                    aria-label="Category"
                    value={category}
                    onChange={(event) => {
                      if (event.target.value !== NEW)
                        return setCategory(event.target.value);
                      const typed = (
                        window.prompt("Name of the new category:") ?? ""
                      ).trim();
                      if (typed) setCategory(typed.slice(0, 60));
                    }}
                    className="input"
                  >
                    <option value="">Select category</option>
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    <option value={NEW}>+ New category…</option>
                  </select>
                </label>
                <label className="block">
                  <span className="label">SKU</span>
                  <input
                    name="sku"
                    value={values.sku}
                    onChange={(event) => set({ sku: event.target.value })}
                    className="input font-semibold uppercase"
                  />
                </label>
              </div>
            </div>

            <dl className="space-y-2 xl:border-l xl:border-stone-200 xl:pl-4">
              <div
                data-price-table
                className="overflow-hidden rounded-lg border border-stone-200"
              >
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="bg-brand-50 text-left">
                      <th className="px-2.5 py-1.5 font-bold">
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          <Tag className="size-3.5 text-brand" /> Selling Price
                        </span>
                      </th>
                      <th className="px-1 py-1.5 font-semibold text-stone-600">
                        Price ({currency})
                      </th>
                      <th className="px-2.5 py-1.5 text-right font-semibold text-stone-600">
                        Works out as
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceRows.map((row) => {
                      const own = values[row.key].trim();
                      const one = typedAmount(values.price);
                      const offer = {
                        price2: typedAmount(values.price2),
                        price3: typedAmount(values.price3),
                        price4: typedAmount(values.price4),
                      };
                      // What this many cost, and what the last of them adds.
                      const total = one === null ? null : offerTotal(one, offer, row.pieces);
                      const adds = one === null ? null : pieceCost(one, offer, row.pieces);
                      const before =
                        one === null || row.pieces === 1
                          ? null
                          : offerTotal(one, offer, row.pieces - 1);
                      const tooLow =
                        own !== "" && before !== null && (typedAmount(own) ?? 0) < before;
                      return (
                        <tr key={row.key} className="border-t border-stone-100">
                          <th className="px-2.5 py-1 text-left font-semibold whitespace-nowrap">
                            {row.label}
                          </th>
                          <td className="px-1 py-1">
                            <input
                              name={row.key}
                              inputMode="decimal"
                              aria-label={`Price for ${row.label}`}
                              value={values[row.key]}
                              onChange={(event) =>
                                set({ [row.key]: event.target.value })
                              }
                              placeholder={
                                row.key === "price"
                                  ? price.varies
                                    ? "varies"
                                    : "0"
                                  : total === null
                                    ? ""
                                    : String(total)
                              }
                              title={
                                row.key === "price" && price.varies
                                  ? "Sizes and colors have different prices. Typing one here sets it for all of them."
                                  : undefined
                              }
                              className={
                                "h-7 w-full min-w-14 rounded-md border bg-white px-2 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-stone-400 focus:border-brand focus:ring-1 focus:ring-brand " +
                                (tooLow ? "border-rose-500" : "border-stone-200")
                              }
                            />
                          </td>
                          <td
                            data-price-note={row.pieces}
                            className={
                              "px-2.5 py-1 text-right whitespace-nowrap " +
                              (tooLow
                                ? "font-semibold text-rose-700"
                                : own
                                  ? "font-semibold"
                                  : "text-stone-400")
                            }
                          >
                            {adds === null
                              ? "—"
                              : tooLow
                                ? `Less than ${row.pieces - 1} ${row.pieces === 2 ? "piece" : "pieces"}`
                                : row.pieces === 1
                                  ? `${formatMoney(adds, currency)} each`
                                  : row.pieces === 4
                                    ? `4th and each extra ${formatMoney(adds, currency)}`
                                    : `${row.nth} piece for ${formatMoney(adds, currency)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center gap-3">
                <Layers className="size-4 shrink-0 text-brand" />
                <dt className="min-w-0 flex-1 text-xs font-semibold">
                  Average Purchase Cost
                </dt>
                <dd
                  className="w-36 shrink-0 sm:w-40"
                  data-metric="average-cost"
                >
                  <span className={plain}>{metrics.averageCost}</span>
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <Package className="size-4 shrink-0 text-brand" />
                <dt className="min-w-0 flex-1 text-xs font-semibold">
                  Available Stock
                </dt>
                <dd className="w-36 shrink-0 sm:w-40" data-metric="available">
                  <span className={box + " border-brand-100 bg-brand-100"}>
                    {metrics.available}
                  </span>
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <Coins className="size-4 shrink-0 text-brand" />
                <dt className="min-w-0 flex-1 text-xs font-semibold">
                  Total Purchased Value
                </dt>
                <dd
                  className="w-36 shrink-0 sm:w-40"
                  data-metric="purchased-value"
                >
                  <span className={plain}>{metrics.purchasedValue}</span>
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </form>
  );
}
