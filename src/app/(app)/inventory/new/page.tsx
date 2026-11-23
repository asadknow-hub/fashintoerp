import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Field, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createProduct } from "../actions";

export default async function NewProductPage() {
  await requireUser();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Add product" />
      <ActionForm
        action={createProduct}
        submit="Save product"
        className="card space-y-5 p-6"
      >
        <Field label="Product name">
          <input name="name" required placeholder="Linen Shirt" className="input" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category (optional)">
            <input name="category" placeholder="Shirts" className="input" />
          </Field>
          <Field label="Description (optional)">
            <input name="description" className="input" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sizes" hint="Separate with commas. Leave empty if one size.">
            <input name="sizes" placeholder="S, M, L, XL" className="input" />
          </Field>
          <Field label="Colors" hint="Separate with commas. Leave empty if one color.">
            <input name="colors" placeholder="Black, White" className="input" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Selling price">
            <input name="price" inputMode="decimal" required className="input" />
          </Field>
          <Field label="Your cost">
            <input name="cost" inputMode="decimal" className="input" />
          </Field>
          <Field label="Stock (each)">
            <input name="stock" inputMode="numeric" defaultValue="0" className="input" />
          </Field>
          <Field label="Low stock alert">
            <input name="lowStockAt" inputMode="numeric" defaultValue="5" className="input" />
          </Field>
        </div>
        <p className="text-xs text-stone-500">
          One item is created for every size and color combination. You can
          change price and stock for each one afterwards.
        </p>
      </ActionForm>
      <Link href="/inventory" className="mt-4 inline-block text-sm text-stone-600 hover:underline">
        ← Back to inventory
      </Link>
    </div>
  );
}
