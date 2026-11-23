"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { createOrder } from "../actions";

export type Sellable = {
  id: string;
  label: string;
  price: number;
  stock: number;
};

type Row = { key: number; variantId: string; quantity: string; unitPrice: string };

export function OrderForm({
  sellables,
  currency,
  defaults,
}: {
  sellables: Sellable[];
  currency: string;
  defaults: { name: string; phone: string; conversationId: string; source: string };
}) {
  const [rows, setRows] = useState<Row[]>([
    { key: 0, variantId: "", quantity: "1", unitPrice: "" },
  ]);
  const [shippingFee, setShippingFee] = useState("");
  const [discount, setDiscount] = useState("");
  const byId = new Map(sellables.map((s) => [s.id, s]));

  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  const filled = rows.filter((row) => row.variantId);
  const subtotal = filled.reduce(
    (sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0),
    0,
  );
  const total = subtotal + (Number(shippingFee) || 0) - (Number(discount) || 0);

  return (
    <ActionForm action={createOrder} submit="Create order" className="space-y-6">
      <input type="hidden" name="conversationId" value={defaults.conversationId} />
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(
          filled.map((row) => ({
            variantId: row.variantId,
            quantity: Number(row.quantity),
            unitPrice: Number(row.unitPrice),
          })),
        )}
      />

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold">Customer</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input name="name" required defaultValue={defaults.name} className="input" />
          </Field>
          <Field label="Phone">
            <input name="phone" inputMode="tel" defaultValue={defaults.phone} className="input" />
          </Field>
          <Field label="Address">
            <input name="address" className="input" />
          </Field>
          <Field label="City">
            <input name="city" className="input" />
          </Field>
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold">Items</h2>
        {sellables.length === 0 && (
          <p className="text-sm text-stone-500">
            You have no products yet. Add products in Inventory first.
          </p>
        )}
        {rows.map((row) => {
          const picked = byId.get(row.variantId);
          const tooMany = picked && Number(row.quantity) > picked.stock;
          return (
            <div key={row.key} className="grid grid-cols-[1fr_4.5rem_6rem_2rem] items-end gap-2">
              <Field label="Product">
                <select
                  className="input"
                  value={row.variantId}
                  onChange={(event) => {
                    const next = byId.get(event.target.value);
                    update(row.key, {
                      variantId: event.target.value,
                      unitPrice: next ? String(next.price) : "",
                    });
                  }}
                >
                  <option value="">Choose…</option>
                  {sellables.map((s) => (
                    <option key={s.id} value={s.id} disabled={s.stock <= 0}>
                      {s.label} — {s.stock > 0 ? `${s.stock} left` : "out of stock"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Qty">
                <input
                  className="input"
                  inputMode="numeric"
                  value={row.quantity}
                  onChange={(event) => update(row.key, { quantity: event.target.value })}
                />
              </Field>
              <Field label="Price each">
                <input
                  className="input"
                  inputMode="decimal"
                  value={row.unitPrice}
                  onChange={(event) => update(row.key, { unitPrice: event.target.value })}
                />
              </Field>
              <button
                type="button"
                aria-label="Remove item"
                disabled={rows.length === 1}
                onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                className="mb-1 h-8 cursor-pointer rounded-lg text-lg text-stone-500 hover:bg-stone-100 disabled:opacity-30"
              >
                ×
              </button>
              {tooMany && (
                <p className="col-span-4 text-xs text-rose-700">
                  Only {picked.stock} in stock.
                </p>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                key: Math.max(...current.map((r) => r.key)) + 1,
                variantId: "",
                quantity: "1",
                unitPrice: "",
              },
            ])
          }
        >
          + Add another item
        </button>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold">Payment & delivery</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Payment">
            <select name="payment" className="input" defaultValue="cod">
              <option value="cod">Cash on delivery</option>
              <option value="prepaid">Already paid</option>
            </select>
          </Field>
          <Field label="Delivery fee">
            <input
              name="shippingFee"
              inputMode="decimal"
              className="input"
              value={shippingFee}
              onChange={(event) => setShippingFee(event.target.value)}
            />
          </Field>
          <Field label="Discount">
            <input
              name="discount"
              inputMode="decimal"
              className="input"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
            />
          </Field>
          <Field label="Came from">
            <input
              name="source"
              placeholder="Instagram, WhatsApp…"
              defaultValue={defaults.source}
              className="input"
            />
          </Field>
        </div>
        <Field label="Notes (optional)">
          <textarea name="notes" rows={2} className="input" />
        </Field>
        <p className="border-t border-stone-100 pt-4 text-right text-sm">
          Total{" "}
          <span className="ml-2 text-lg font-semibold tabular-nums">
            {formatMoney(Math.max(total, 0), currency)}
          </span>
        </p>
      </section>
    </ActionForm>
  );
}
