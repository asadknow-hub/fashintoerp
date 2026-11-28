import { SearchX } from "lucide-react";
import Link from "next/link";

// Shown for an address that leads nowhere: an order that was deleted, a
// mistyped link. The menu stays, and there is a way back.
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4" data-not-found>
      <div className="card w-full max-w-md p-6 text-center">
        <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-brand-100 text-brand">
          <SearchX className="size-6" />
        </span>
        <h1 className="text-lg font-extrabold tracking-tight">This page was not found</h1>
        <p className="mt-1 text-sm text-stone-600">
          It may have been deleted, or the link is wrong. Nothing else is affected.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/orders" className="btn">
            All orders
          </Link>
          <Link href="/" className="btn-secondary">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
