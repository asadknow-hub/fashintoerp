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
} from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useState, useTransition } from "react";
import type { MediaItem } from "@/components/media-manager";
import { Badge } from "@/components/ui";
import type { MediaMode } from "@/lib/media-rules";
import { setArchived, updateProduct } from "../actions";
import { MediaBlock } from "./media-block";

const NEW = "__new__";

// The top of the product page: its name and main buttons, the photo gallery,
// and the "Product Information" card. Save stores everything in that card.
export function ProductTop({
  product,
  categories,
  price,
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
  currency: string;
  metrics: { averageCost: string; available: string; purchasedValue: string };
  media: MediaItem[];
  mode: MediaMode;
  offReason: string | null;
}) {
  const [state, save, saving] = useActionState(updateProduct.bind(null, product.id), null);
  const [category, setCategory] = useState(product.category ?? "");
  const [archiving, startArchive] = useTransition();
  const options = [...new Set([...categories, category].filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

  const receive = () => {
    // The stock grid further down listens for this and opens its "receive" boxes.
    window.dispatchEvent(new Event("stock:receive"));
    document.getElementById("variants")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const box = "flex h-9 w-full items-center rounded-lg border px-3 text-sm font-semibold tabular-nums";
  const plain = box + " border-stone-200 bg-white";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => save(data));
      }}
      className="space-y-3"
    >
      <div>
        <Link
          href="/inventory"
          className="inline-flex items-center gap-2 text-xs font-medium text-stone-500 hover:text-brand"
        >
          <ArrowLeft className="size-3.5" /> Inventory
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link href="/inventory" aria-label="Back to inventory" className="text-stone-700 hover:text-brand">
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="min-w-0 truncate text-xl font-extrabold tracking-tight">{product.name}</h1>
          {product.archived && <Badge>Archived</Badge>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {state?.error && (
              <span role="alert" className="text-xs font-semibold text-rose-700">
                {state.error}
              </span>
            )}
            {state?.ok && !saving && (
              <span role="status" className="text-xs font-semibold text-emerald-700">
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
              {archiving ? "Working…" : product.archived ? "Restore Product" : "Archive Product"}
            </button>
            <button type="button" onClick={receive} className="btn-secondary">
              <Plus className="size-4" /> Receive Stock
            </button>
            <button type="submit" disabled={saving} className="btn px-5">
              <Check className="size-4" /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <MediaBlock productId={product.id} items={media} mode={mode} offReason={offReason} />

        <section className="card p-4" data-product-info>
          <h2 className="mb-3 text-sm font-bold">Product Information</h2>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="space-y-2.5">
              <label className="block">
                <span className="label">
                  Name <span className="text-rose-600">*</span>
                </span>
                <input name="name" required defaultValue={product.name} className="input" />
              </label>
              <label className="block">
                <span className="label">Description</span>
                <textarea
                  name="description"
                  rows={2}
                  defaultValue={product.description ?? ""}
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
                      if (event.target.value !== NEW) return setCategory(event.target.value);
                      const typed = (window.prompt("Name of the new category:") ?? "").trim();
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
                    defaultValue={product.sku ?? ""}
                    className="input font-semibold uppercase"
                  />
                </label>
              </div>
            </div>

            <dl className="space-y-2 xl:border-l xl:border-stone-200 xl:pl-4">
              <div className="flex items-center gap-3">
                <Tag className="size-4 shrink-0 text-brand" />
                <dt className="min-w-0 flex-1 text-xs font-semibold">Selling Price</dt>
                <dd className="w-36 shrink-0 sm:w-40">
                  <span
                    className={
                      plain +
                      " gap-1.5 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand"
                    }
                  >
                    <span className="text-stone-500">{currency}</span>
                    <input
                      name="price"
                      inputMode="decimal"
                      aria-label="Selling Price"
                      defaultValue={price.value}
                      placeholder={price.varies ? "varies" : "0"}
                      title={
                        price.varies
                          ? "Sizes and colors have different prices. Typing one here sets it for all of them."
                          : undefined
                      }
                      className="w-full min-w-0 bg-transparent font-semibold outline-none placeholder:font-normal placeholder:text-stone-400"
                    />
                  </span>
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <Layers className="size-4 shrink-0 text-brand" />
                <dt className="min-w-0 flex-1 text-xs font-semibold">Average Purchase Cost</dt>
                <dd className="w-36 shrink-0 sm:w-40" data-metric="average-cost">
                  <span className={plain}>{metrics.averageCost}</span>
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <Package className="size-4 shrink-0 text-brand" />
                <dt className="min-w-0 flex-1 text-xs font-semibold">Available Stock</dt>
                <dd className="w-36 shrink-0 sm:w-40" data-metric="available">
                  <span className={box + " border-brand-100 bg-brand-100"}>{metrics.available}</span>
                </dd>
              </div>
              <div className="flex items-center gap-3">
                <Coins className="size-4 shrink-0 text-brand" />
                <dt className="min-w-0 flex-1 text-xs font-semibold">Total Purchased Value</dt>
                <dd className="w-36 shrink-0 sm:w-40" data-metric="purchased-value">
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
