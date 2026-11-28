"use client";

import { Plus, Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { addCompany, removeCompany, updateCompany } from "./actions";

export type CompanyRow = { id: string; name: string; rate: number; openedFee: number };

// The courier companies and what each usually charges for one delivery.
// They are offered in an order's Actions when it is entered in a portal.
export function Companies({
  companies,
  canEdit,
  currency,
}: {
  companies: CompanyRow[];
  canEdit: boolean;
  currency: string;
}) {
  const [added, add, adding] = useActionState(addCompany, null);
  const [, startSend] = useTransition();
  const [seen, setSeen] = useState(added);
  // Bumped after each company is added, to empty the boxes for the next one.
  const [round, setRound] = useState(0);
  if (added !== seen) {
    setSeen(added);
    if (added?.ok) setRound((n) => n + 1);
  }

  return (
    <div className="card" data-companies>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_auto] items-center gap-x-2 border-b border-stone-200 px-3 py-2 text-xs font-semibold text-stone-600">
        <span>Company</span>
        <span>Delivery ({currency})</span>
        <span>Opened ({currency})</span>
        <span className="w-[7.5rem]" />
      </div>
      {companies.length === 0 && (
        <p className="px-3 py-3 text-sm text-stone-500">
          No delivery companies yet.{canEdit ? " Add the first one below." : ""}
        </p>
      )}
      {companies.map((company) =>
        canEdit ? (
          <Row key={company.id} company={company} />
        ) : (
          <div
            key={company.id}
            className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_auto] items-center gap-x-2 border-b border-stone-100 px-3 py-2 text-sm"
          >
            <span className="font-semibold">{company.name}</span>
            <span className="tabular-nums">{company.rate.toFixed(2)}</span>
            <span className="tabular-nums">{company.openedFee.toFixed(2)}</span>
            <span className="w-[7.5rem]" />
          </div>
        ),
      )}
      {canEdit && (
        <form
          key={round}
          // Sent by hand, so what was typed stays when the save is refused.
          onSubmit={(event) => {
            event.preventDefault();
            if (adding) return;
            const data = new FormData(event.currentTarget);
            startSend(() => add(data));
          }}
          className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_auto] items-center gap-x-2 px-3 py-2.5"
        >
          <input
            name="name"
            required
            aria-label="New company name"
            placeholder="Company name"
            className="input"
          />
          <input
            name="rate"
            inputMode="decimal"
            aria-label="New company delivery charge"
            placeholder="0.00"
            className="input tabular-nums"
          />
          <input
            name="openedFee"
            inputMode="decimal"
            aria-label="New company opened-parcel charge"
            placeholder="10.00"
            className="input tabular-nums"
          />
          <button type="submit" disabled={adding} className="btn w-[7.5rem] justify-center">
            <Plus className="size-4" /> {adding ? "Adding…" : "Add"}
          </button>
          {added?.error && (
            <p role="alert" className="col-span-4 mt-1 text-xs font-semibold text-rose-700">
              {added.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function Row({ company }: { company: CompanyRow }) {
  const [state, save, saving] = useActionState(updateCompany.bind(null, company.id), null);
  const [removing, startRemove] = useTransition();
  const [, startSend] = useTransition();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (saving) return;
        const data = new FormData(event.currentTarget);
        startSend(() => save(data));
      }}
      data-company={company.name}
      className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_auto] items-center gap-x-2 border-b border-stone-100 px-3 py-2"
    >
      <input
        name="name"
        required
        aria-label="Company name"
        defaultValue={company.name}
        className="input font-semibold"
      />
      <input
        name="rate"
        inputMode="decimal"
        aria-label="Delivery charge"
        defaultValue={company.rate.toFixed(2)}
        className="input tabular-nums"
      />
      <input
        name="openedFee"
        inputMode="decimal"
        aria-label="Opened-parcel charge"
        defaultValue={company.openedFee.toFixed(2)}
        className="input tabular-nums"
      />
      <span className="flex w-[7.5rem] gap-1.5">
        <button type="submit" disabled={saving} className="btn-secondary flex-1 justify-center">
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={removing}
          aria-label={`Remove ${company.name}`}
          title="Remove this company"
          onClick={() => {
            if (window.confirm(`Remove ${company.name}? Orders already sent with it keep its name.`)) {
              startRemove(async () => {
                await removeCompany(company.id);
              });
            }
          }}
          className="btn-secondary px-2.5 text-rose-700"
        >
          <Trash2 className="size-4" />
        </button>
      </span>
      {(state?.error || state?.ok) && (
        <p
          role={state.error ? "alert" : "status"}
          className={
            "col-span-4 mt-1 text-xs font-semibold " +
            (state.error ? "text-rose-700" : "text-emerald-700")
          }
        >
          {state.error ?? state.ok}
        </p>
      )}
    </form>
  );
}
