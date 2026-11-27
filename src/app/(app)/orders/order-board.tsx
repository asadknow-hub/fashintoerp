"use client";

import { GripVertical, ListChecks } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ExchangeInfo } from "@/components/ui";
import { type Company, type OrderCard, type Stage, StepsModal } from "./order-actions";

const columns: { stage: Stage; label: string; hint: string; tone: string }[] = [
  { stage: "new", label: "New", hint: "Not in a delivery portal yet", tone: "bg-sky-500" },
  { stage: "portal", label: "In portal", hint: "With the delivery company", tone: "bg-brand" },
  { stage: "dispatched", label: "Dispatched", hint: "On the way to the customer", tone: "bg-amber-500" },
  { stage: "delivered", label: "Delivered", hint: "Last 7 days", tone: "bg-emerald-500" },
];

// The orders as cards in columns, one column per step. A card can be dragged
// to another column, which opens its Actions with that step ticked: the
// company or the delivery charge is still asked before anything is saved.
export function OrderBoard({
  cards,
  companies,
  currency,
}: {
  cards: OrderCard[];
  companies: Company[];
  currency: string;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [opened, setOpened] = useState<{ id: string; preset?: Stage } | null>(null);
  const open = opened ? cards.find((card) => card.id === opened.id) : undefined;

  return (
    <>
      <div
        data-board
        className="grid grid-flow-col auto-cols-[minmax(15.5rem,1fr)] gap-3 overflow-x-auto pb-2"
      >
        {columns.map((column) => {
          const mine = cards.filter((card) => card.stage === column.stage);
          return (
            <section
              key={column.stage}
              data-column={column.stage}
              onDragOver={(event) => {
                if (!dragging) return;
                event.preventDefault();
                setOver(column.stage);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const card = cards.find((c) => c.id === dragging);
                setDragging(null);
                setOver(null);
                if (card && card.stage !== column.stage) {
                  setOpened({ id: card.id, preset: column.stage });
                }
              }}
              className={
                "flex min-h-40 flex-col rounded-xl border bg-stone-100/70 transition " +
                (over === column.stage ? "border-brand ring-2 ring-brand-200" : "border-stone-200")
              }
            >
              <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                <span className={"size-2.5 rounded-full " + column.tone} />
                <h2 className="text-sm font-bold whitespace-nowrap">{column.label}</h2>
                <span
                  data-column-count
                  className="rounded-full bg-white px-2 py-0.5 text-xs font-bold tabular-nums text-stone-600"
                >
                  {mine.length}
                </span>
                <span className="ml-auto truncate text-[11px] text-stone-500">{column.hint}</span>
              </header>
              <ul className="flex flex-1 flex-col gap-2 px-2 pb-2">
                {mine.length === 0 && (
                  <li className="rounded-lg border border-dashed border-stone-300 px-3 py-5 text-center text-xs text-stone-500">
                    Nothing here
                  </li>
                )}
                {mine.map((card) => (
                  <li
                    key={card.id}
                    data-card={card.number}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(card.number));
                      setDragging(card.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={
                      "card cursor-grab p-2.5 text-[13px] leading-snug active:cursor-grabbing " +
                      (dragging === card.id ? "opacity-50" : "")
                    }
                  >
                    <div className="flex items-center gap-1.5">
                      <GripVertical className="size-3.5 shrink-0 text-stone-400" />
                      <Link
                        href={`/orders/${card.id}`}
                        className="font-bold tabular-nums hover:text-brand hover:underline"
                      >
                        {card.name}
                      </Link>
                      {card.exchangeOf && <ExchangeInfo of={card.exchangeOf} />}
                      <span className="ml-auto font-bold whitespace-nowrap tabular-nums">
                        {card.cod}
                      </span>
                    </div>
                    <p className="mt-1 font-semibold">{card.customer}</p>
                    {card.phone && <p className="text-xs text-stone-500">{card.phone}</p>}
                    {card.place && <p className="mt-0.5 text-xs text-stone-600">{card.place}</p>}
                    {card.contents && <p className="mt-1 text-xs">{card.contents}</p>}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-stone-500">
                        {card.company ?? ""}
                        {card.deliveryCharge !== null &&
                          ` · ${currency} ${card.deliveryCharge.toFixed(2)}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setOpened({ id: card.id })}
                        aria-label={`Actions for order ${card.name}`}
                        className="btn-secondary btn-sm whitespace-nowrap"
                      >
                        <ListChecks className="size-3.5" /> Actions
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {open && (
        <StepsModal
          key={open.id + (opened?.preset ?? "")}
          order={open}
          companies={companies}
          currency={currency}
          preset={opened?.preset}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}
