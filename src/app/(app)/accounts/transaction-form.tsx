"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { deleteTransaction, saveTransaction } from "./actions";

export type Line = {
  id: string;
  // As 2026-11-28.
  day: string;
  direction: "out" | "in";
  amount: string;
  purpose: string;
  byUserId: string | null;
};

// The button that opens the "add a transaction" pop-up, or, given a line,
// the pencil that opens the same pop-up to correct or delete it.
export function TransactionButton({
  line,
  people,
  me,
  today,
  currency,
  purposes,
}: {
  line?: Line;
  // Everyone a transaction can be "by".
  people: { id: string; name: string }[];
  // Who is signed in: a new line starts as theirs.
  me: string;
  // Today as 2026-11-28: a line can't be dated later.
  today: string;
  currency: string;
  // Purposes used before, offered while typing.
  purposes: string[];
}) {
  const [open, setOpen] = useState(false);
  const [result, save, saving] = useActionState(saveTransaction.bind(null, line?.id ?? null), null);
  const [, startSend] = useTransition();
  const [removing, startRemove] = useTransition();
  const [gone, setGone] = useState<string | null>(null);
  const [direction, setDirection] = useState<"out" | "in">(line?.direction ?? "out");
  const [seen, setSeen] = useState(result);
  if (result !== seen) {
    setSeen(result);
    if (result?.ok) setOpen(false);
  }
  const start = () => {
    setDirection(line?.direction ?? "out");
    setGone(null);
    setOpen(true);
  };
  const kind = (value: "out" | "in", label: string, hint: string) => (
    <label
      className={
        "flex flex-1 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 " +
        (direction === value ? "border-brand bg-brand-50" : "border-stone-200 hover:bg-stone-50")
      }
    >
      <input
        type="radio"
        name="direction"
        value={value}
        checked={direction === value}
        onChange={() => setDirection(value)}
        className="mt-0.5 size-4 shrink-0 accent-[#5b4fd9]"
      />
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-xs text-stone-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <>
      {line ? (
        <button
          type="button"
          onClick={start}
          aria-label={`Edit: ${line.purpose}`}
          title="Edit or delete"
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded text-stone-400 hover:bg-brand-100 hover:text-brand"
        >
          <Pencil className="size-3.5" />
        </button>
      ) : (
        <button type="button" onClick={start} data-add-transaction className="btn">
          <Plus className="size-4" /> Add transaction
        </button>
      )}
      {open && (
        <Modal
          title={line ? "Edit transaction" : "Add transaction"}
          subtitle="Money that went out or came in, apart from orders and stock."
          onClose={() => setOpen(false)}
        >
          <form
            data-transaction-form
            onSubmit={(event) => {
              event.preventDefault();
              if (saving) return;
              const data = new FormData(event.currentTarget);
              startSend(() => save(data));
            }}
          >
            <div className="space-y-3 p-4 text-sm">
              <div className="flex flex-wrap gap-2">
                {kind("out", "Paid out", "Rent, packaging, salaries, ads…")}
                {kind("in", "Received", "Money that came in, not from an order")}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label">Date</span>
                  <input
                    type="date"
                    name="day"
                    required
                    defaultValue={line?.day ?? today}
                    max={today}
                    className="input"
                  />
                </label>
                <label className="block">
                  <span className="label">Amount ({currency})</span>
                  <input
                    name="amount"
                    required
                    data-autofocus
                    inputMode="decimal"
                    defaultValue={line ? Number(line.amount).toFixed(2) : ""}
                    placeholder="0.00"
                    className="input tabular-nums"
                  />
                </label>
              </div>
              <label className="block">
                <span className="label">Purpose</span>
                <input
                  name="purpose"
                  required
                  maxLength={200}
                  list="transaction-purposes"
                  defaultValue={line?.purpose ?? ""}
                  placeholder="What it was for"
                  autoComplete="off"
                  className="input"
                />
                <datalist id="transaction-purposes">
                  {purposes.map((purpose) => (
                    <option key={purpose} value={purpose} />
                  ))}
                </datalist>
              </label>
              <label className="block">
                <span className="label">By</span>
                <select name="by" defaultValue={line?.byUserId ?? me} className="input">
                  {/* A line by someone whose account is gone keeps the choice empty. */}
                  {line && line.byUserId === null && <option value="">Choose who</option>}
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              {(result?.error || gone) && (
                <p role="alert" className="font-semibold text-rose-700">
                  {result?.error ?? gone}
                </p>
              )}
            </div>
            <footer className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-stone-50 px-4 py-3">
              {line && (
                <button
                  type="button"
                  disabled={removing}
                  onClick={() => {
                    if (!window.confirm(`Delete "${line.purpose}" from the accounts?`)) return;
                    startRemove(async () => {
                      const outcome = await deleteTransaction(line.id);
                      if (outcome?.error) setGone(outcome.error);
                      else setOpen(false);
                    });
                  }}
                  className="btn-secondary text-rose-700"
                >
                  <Trash2 className="size-4" /> {removing ? "Deleting…" : "Delete"}
                </button>
              )}
              <span className="ml-auto flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
                  Close
                </button>
                <button type="submit" disabled={saving} className="btn px-5">
                  {saving ? "Saving…" : "Save"}
                </button>
              </span>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
