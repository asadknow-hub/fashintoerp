"use client";

import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Globe,
  Hash,
  MapPin,
  Minus,
  Package,
  Plus,
  Quote,
  Repeat,
  Search,
  Smartphone,
  Trash2,
  User,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import type { ActionState } from "@/components/action-form";
import { colorDot } from "@/lib/colors";
import { formatMoney, variantLabel } from "@/lib/format";
import { COUNTRIES, DEFAULT_COUNTRY, UAE_AREAS, UAE_CITIES } from "@/lib/locations";
import { pieceCost } from "@/lib/offer";
import { createOrder, lookupCustomer, releaseShipperRef, watchShipperRef } from "../actions";

export type OrderVariant = {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
  price: number;
  stock: number;
};

export type OrderProduct = {
  id: string;
  name: string;
  category: string | null;
  photo: string | null;
  // What 2, 3 and 4 pieces of this product cost together (see lib/offer.ts).
  price2: number | null;
  price3: number | null;
  price4: number | null;
  colors: (string | null)[];
  sizes: (string | null)[];
  variants: OrderVariant[];
};

// One line of the order. Color and size are "undefined" until chosen; null
// means the product simply has no color (or size) to choose.
type Row = {
  key: number;
  productId: string;
  color: string | null | undefined;
  size: string | null | undefined;
  quantity: string;
  // Only used once someone types their own price; until then the price
  // comes from the product and follows how many pieces are ordered.
  unitPrice: string;
  priceTyped?: boolean;
};

const blank = (key: number): Row => ({
  key,
  productId: "",
  color: undefined,
  size: undefined,
  quantity: "1",
  unitPrice: "",
});

type Customer = {
  name: string;
  phone: string;
  phone2: string;
  country: string;
  city: string;
  area: string;
  street: string;
};

const noCustomer = (name = "", phone = ""): Customer => ({
  name,
  phone,
  phone2: "",
  country: DEFAULT_COUNTRY,
  city: "",
  area: "",
  street: "",
});

const left = (n: number) => (n > 0 ? `${n} left` : "out of stock");
const OTHER = "__other__";

/* ---------- Small pieces ---------- */

// A field with its icon in a box on the left, as in the design.
function IconBox({
  icon: Icon,
  children,
  className = "",
}: {
  icon: typeof User;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={
        "flex h-10 overflow-hidden rounded-lg border border-stone-200 bg-white focus-within:border-brand focus-within:ring-1 focus-within:ring-brand " +
        className
      }
    >
      <span className="flex w-11 shrink-0 items-center justify-center border-r border-stone-200 text-stone-800">
        <Icon className="size-[18px]" strokeWidth={2} />
      </span>
      {children}
    </span>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-[13px] font-semibold text-stone-800">
      {children}
      {required && <span className="text-rose-600"> *</span>}
    </span>
  );
}

const inside = "min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-stone-400";
const selectInside = inside + " cursor-pointer appearance-none pr-8 font-semibold";

// A dropdown inside an icon box, with its little arrow.
function Arrow() {
  return (
    <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-stone-700" />
  );
}

// City or area: a list to pick from where we have one, with "Other…" to type
// a place that is missing; a plain box to type in otherwise.
function PlaceField({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  options: string[] | null;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  if (!options) {
    return (
      <input
        aria-label={label}
        value={value}
        placeholder={label}
        onChange={(event) => onChange(event.target.value)}
        className={inside}
      />
    );
  }
  const list = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <span className="relative flex min-w-0 flex-1">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          if (event.target.value !== OTHER) return onChange(event.target.value);
          const typed = (window.prompt(`Type the ${label.toLowerCase()}:`) ?? "").trim();
          if (typed) onChange(typed.slice(0, 60));
        }}
        className={selectInside + (value ? "" : " font-medium text-stone-900")}
      >
        <option value="">{placeholder}</option>
        {list.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      <Arrow />
    </span>
  );
}

// A dropdown with a search box inside it: click it, type a few letters, pick.
// A name that is not in the list can be used as typed.
function SearchSelect({
  icon,
  label,
  value,
  options,
  placeholder,
  emptyText,
  onChange,
}: {
  icon: typeof User;
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  emptyText: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const words = query.trim().toLowerCase();
  const typed = query.trim().slice(0, 60);
  const matches = options.filter((option) => option.toLowerCase().includes(words));
  // Typed something that is not in the list: offer to use it as it is.
  const custom =
    typed && !options.some((option) => option.toLowerCase() === words) ? typed : null;
  const choices = custom ? [...matches, custom] : matches;

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const pick = (choice: string | undefined) => {
    if (!choice) return;
    onChange(choice);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <IconBox icon={icon} className={open ? "border-brand ring-1 ring-brand" : ""}>
        <span className="relative flex min-w-0 flex-1">
          <button
            type="button"
            aria-label={label}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => {
              setQuery("");
              setActive(0);
              setOpen((was) => !was);
            }}
            className={
              "w-full truncate text-left " +
              selectInside +
              (value ? "" : " font-medium text-stone-900")
            }
          >
            {value || placeholder}
          </button>
          <Arrow />
        </span>
      </IconBox>
      {open && (
        <div
          data-search-select
          className="absolute inset-x-0 top-full z-30 mt-1 min-w-56 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-stone-200 px-2.5">
            <Search className="size-4 shrink-0 text-stone-400" />
            <input
              autoFocus
              aria-label={`Search ${label.toLowerCase()}`}
              autoComplete="off"
              value={query}
              placeholder={`Search ${label.toLowerCase()}…`}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActive((index) => Math.min(index + 1, choices.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter") {
                  // Enter picks; it must not send the whole order.
                  event.preventDefault();
                  pick(choices[active]);
                } else if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400"
            />
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {choices.length === 0 && (
              <li className="px-3 py-2 text-sm text-stone-500">{emptyText}</li>
            )}
            {choices.map((choice, index) => (
              <li
                key={choice === custom ? "\u0000custom" : choice}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(choice);
                }}
                className={
                  "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm " +
                  (index === active ? "bg-brand-50" : "") +
                  (choice === value ? " font-bold text-brand" : "")
                }
              >
                {choice === custom ? (
                  <>
                    <Plus className="size-3.5 text-brand" /> Use “{choice}”
                  </>
                ) : (
                  choice
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// A box to type in that also offers saved lines to pick from.
function SuggestInput({
  icon,
  name,
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  icon: typeof User;
  name: string;
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const words = value.trim().toLowerCase();
  // Everything while the box is empty or already holds a saved line;
  // otherwise only the saved lines that match what is typed.
  const exact = options.some((option) => option.toLowerCase() === words);
  const matches =
    words && !exact ? options.filter((option) => option.toLowerCase().includes(words)) : options;
  const shown = open && matches.length > 0;

  const pick = (choice: string) => {
    onChange(choice);
    setOpen(false);
  };

  return (
    <div className="relative">
      <IconBox icon={icon}>
        <span className="relative flex min-w-0 flex-1">
          <input
            ref={input}
            name={name}
            role="combobox"
            aria-label={label}
            aria-expanded={shown}
            aria-controls={`${name}-options`}
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            onFocus={() => {
              setActive(-1);
              setOpen(true);
            }}
            onBlur={() => setOpen(false)}
            onChange={(event) => {
              onChange(event.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setActive((index) => Math.min(index + 1, matches.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, -1));
              } else if (event.key === "Enter" && shown && active >= 0) {
                event.preventDefault();
                pick(matches[active]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            className={inside + " pr-9"}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Saved ${label.toLowerCase()}s`}
            // Keeps the box focused so the list can open under it.
            onMouseDown={(event) => {
              event.preventDefault();
              input.current?.focus();
              setActive(-1);
              setOpen(!shown);
            }}
            className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center text-stone-700"
          >
            <ChevronDown className="size-4" />
          </button>
        </span>
      </IconBox>
      {shown && (
        <ul
          id={`${name}-options`}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
        >
          {matches.map((option, index) => (
            <li
              key={option}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
              className={
                "cursor-pointer px-3 py-1.5 text-sm " + (index === active ? "bg-brand-50" : "")
              }
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Product search box ---------- */

function ProductPicker({
  products,
  value,
  onPick,
}: {
  products: OrderProduct[];
  value: string;
  onPick: (product: OrderProduct) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = products.find((product) => product.id === value);
  const words = query.trim().toLowerCase();
  const matches = products
    .filter((product) =>
      `${product.name} ${product.category ?? ""} ${product.variants.map((v) => v.sku).join(" ")}`
        .toLowerCase()
        .includes(words),
    )
    .slice(0, 40);

  const pick = (product: OrderProduct | undefined) => {
    if (!product) return;
    onPick(product);
    setOpen(false);
  };

  return (
    <div className="relative min-w-0 flex-1">
      <input
        role="combobox"
        aria-label="Product"
        aria-expanded={open}
        aria-controls="product-options"
        autoComplete="off"
        placeholder="Choose product…"
        value={open ? query : (selected?.name ?? "")}
        onFocus={() => {
          setQuery("");
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (open) pick(matches[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-10 w-full rounded-lg border border-stone-200 bg-white pr-8 pl-3 text-sm font-semibold outline-none placeholder:font-medium placeholder:text-stone-400 focus:border-brand focus:ring-1 focus:ring-brand"
      />
      <Arrow />
      {open && (
        <ul
          id="product-options"
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full min-w-72 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-lg"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-stone-500">No product matches.</li>
          )}
          {matches.map((product, index) => {
            const stock = product.variants.reduce((sum, v) => sum + v.stock, 0);
            return (
              <li
                key={product.id}
                role="option"
                aria-selected={index === active}
                // Keeps the box focused so the click lands before it closes.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(product);
                }}
                onMouseEnter={() => setActive(index)}
                className={
                  "flex cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-sm " +
                  (index === active ? "bg-brand-50" : "")
                }
              >
                <span className="size-8 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-stone-100">
                  {product.photo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.photo} alt="" className="size-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{product.name}</span>
                  {product.category && (
                    <span className="text-stone-500"> · {product.category}</span>
                  )}
                </span>
                <span
                  className={
                    "shrink-0 text-xs tabular-nums " +
                    (stock > 0 ? "text-stone-500" : "font-semibold text-rose-700")
                  }
                >
                  {stock > 0 ? `${stock} in stock` : "Out of stock"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- Draft: a half-typed order survives a refresh ---------- */

const DRAFT_KEY = "fashinto:new-order:3";
const UNSET = "\u0000unset";

type Draft = {
  rows: Row[];
  customer: Customer;
  shipperRef: string;
  shippingFee: string;
  // Empty while the COD simply follows the order total.
  cod: string;
  instruction: string;
  notes: string;
  // True while the description is the one written out from the items.
  notesAuto?: boolean;
  // Only kept when a day other than today was picked.
  orderDate?: string;
  // True while the FO number is still the one the system filled in.
  refAuto?: boolean;
};

function readDraft(): Draft | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "null") as Draft | null;
    if (!saved || !Array.isArray(saved.rows) || saved.rows.length === 0 || !saved.customer) {
      return null;
    }
    // "Not chosen yet" can't be stored as-is, so it is stored as a marker.
    const rows = saved.rows.map((row) => ({
      ...row,
      color: (row.color as unknown) === UNSET ? undefined : row.color,
      size: (row.size as unknown) === UNSET ? undefined : row.size,
    }));
    return { ...saved, customer: { ...noCustomer(), ...saved.customer }, rows };
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft | null) {
  try {
    if (!draft) return window.localStorage.removeItem(DRAFT_KEY);
    const rows = draft.rows.map((row) => ({
      ...row,
      color: row.color === undefined ? UNSET : row.color,
      size: row.size === undefined ? UNSET : row.size,
    }));
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, rows }));
  } catch {
    // Storage can be blocked (private windows); the form still works without it.
  }
}

const never = () => () => {};

type Props = {
  products: OrderProduct[];
  currency: string;
  timezone: string;
  // Lines offered under "Instruction". The first one is filled in to begin with.
  instructions: string[];
  // The next FO number, which the form starts with.
  nextRef: string;
  // The title of the screen; the order date sits beside it.
  header: React.ReactNode;
  defaults: {
    name: string;
    phone: string;
    phone2: string;
    country: string;
    city: string;
    area: string;
    street: string;
    conversationId: string;
    source: string;
    // The COD to start with (an exchange starts with the delivery charge).
    cod: string;
    // The order this one replaces, when it is an exchange.
    exchange: { id: string; label: string; courier: string | null } | null;
  };
};

const REF_PREFIX = "FO";

// Today's date where the business is, as 2026-11-27.
const todayIn = (timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

type RefNote = NonNullable<Awaited<ReturnType<typeof watchShipperRef>>>;

/* ---------- The form ---------- */

// The draft lives in the browser, so the form is only drawn there.
export function OrderForm(props: Props) {
  const inBrowser = useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
  return inBrowser ? (
    <Editor {...props} />
  ) : (
    <div className="space-y-4">
      {props.header}
      <div className="card h-96 animate-pulse" />
    </div>
  );
}

function Editor({
  products,
  currency,
  timezone,
  instructions,
  nextRef,
  header,
  defaults,
}: Props) {
  const router = useRouter();
  // An order started from a chat begins with that customer, not an old draft.
  const fromChat = !!(
    defaults.conversationId ||
    defaults.name ||
    defaults.phone ||
    defaults.exchange
  );
  const [draft] = useState(() => (fromChat ? null : readDraft()));
  const [restored, setRestored] = useState(draft !== null);
  const [rows, setRows] = useState<Row[]>(draft?.rows ?? [blank(0)]);
  const [customer, setCustomer] = useState<Customer>(
    draft?.customer ?? {
      ...noCustomer(defaults.name, defaults.phone),
      phone2: defaults.phone2,
      country: defaults.country || DEFAULT_COUNTRY,
      city: defaults.city,
      area: defaults.area,
      street: defaults.street,
    },
  );
  // Only the number is typed; "FO" always goes in front of it.
  // The box starts with the next FO number; it can be changed. A number that
  // was only ever the system's suggestion is refreshed when a draft comes
  // back, since someone may have used it meanwhile.
  const [refAuto, setRefAuto] = useState(draft ? draft.refAuto === true : true);
  const [shipperRef, setShipperRef] = useState(
    (draft && draft.refAuto !== true ? draft.shipperRef : nextRef).replace(/\D/g, ""),
  );
  const fullRef = shipperRef ? REF_PREFIX + shipperRef : "";
  const [refNote, setRefNote] = useState<RefNote | null>(null);
  const [today] = useState(() => todayIn(timezone));
  // Empty means today.
  const [orderDate, setOrderDate] = useState(draft?.orderDate ?? "");
  const [shippingFee, setShippingFee] = useState(draft?.shippingFee ?? "");
  const [cod, setCod] = useState(draft?.cod ?? defaults.cod);
  // The usual instruction is already in the box; it can be changed or emptied.
  const usualInstruction = instructions[0] ?? "";
  const [instruction, setInstruction] = useState(draft?.instruction ?? usualInstruction);
  // The description writes itself from the items until someone types their own.
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [notesAuto, setNotesAuto] = useState(draft ? draft.notesAuto !== false : true);
  const [known, setKnown] = useState<string | null>(null);
  const [, startLookup] = useTransition();
  const [state, run, pending] = useActionState(createOrder, null);

  const touched =
    rows.some((row) => row.productId) ||
    !!(
      customer.name ||
      customer.phone ||
      customer.street ||
      (shipperRef && !refAuto) ||
      (notes && !notesAuto) ||
      instruction !== usualInstruction
    );

  // Keep a copy of everything typed, so a refresh doesn't lose it.
  useEffect(() => {
    if (fromChat) return;
    writeDraft(
      touched
        ? {
            rows,
            customer,
            shipperRef,
            shippingFee,
            cod,
            instruction,
            notes,
            notesAuto,
            orderDate,
            refAuto,
          }
        : null,
    );
  }, [
    fromChat,
    touched,
    rows,
    customer,
    shipperRef,
    shippingFee,
    cod,
    instruction,
    notes,
    notesAuto,
    orderDate,
    refAuto,
  ]);

  // While a shipper ref is in the box, keep asking the system about it: is
  // it already on an order, and is someone else typing the same one? Asking
  // also tells the system that this person is working on it.
  useEffect(() => {
    if (!fullRef) return;
    let stopped = false;
    const ask = async () => {
      try {
        const note = await watchShipperRef(fullRef);
        if (stopped) return;
        // A number the system suggested that got used meanwhile: move on to
        // the next free one. A typed number is left for the person to change.
        if (refAuto && note?.usedBy && note.next) setShipperRef(note.next);
        else setRefNote(note);
      } catch {
        // Offline for a moment; the next round will catch up.
      }
    };
    const first = setTimeout(ask, 400);
    const again = setInterval(() => {
      if (document.visibilityState === "visible") ask();
    }, 15000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(again);
    };
  }, [fullRef, refAuto]);
  const refNow = refNote && refNote.ref === fullRef ? refNote : null;

  const startOver = () => {
    if (fullRef) void releaseShipperRef().catch(() => {});
    setRows([blank(0)]);
    setCustomer(noCustomer());
    setShipperRef(nextRef);
    setRefAuto(true);
    setRefNote(null);
    setOrderDate("");
    setShippingFee("");
    setCod("");
    setInstruction(usualInstruction);
    setNotes("");
    setNotesAuto(true);
    setKnown(null);
    setRestored(false);
    writeDraft(null);
  };

  // Once saved: clear this screen, then open the new order. Remembering which
  // save was followed stops the Back button from jumping forward again.
  const followed = useRef<ActionState>(null);
  const clear = useRef(startOver);
  useEffect(() => {
    clear.current = startOver;
  });
  // "Creating…" stays on the button until the new order's page is showing.
  // Coming back to this screen later (the Back button), it is ready again.
  const [leaving, startLeaving] = useTransition();
  useEffect(() => {
    if (state?.go && followed.current !== state) {
      followed.current = state;
      clear.current();
      const go = state.go;
      startLeaving(() => router.push(go));
    }
  }, [state, router]);

  const productOf = (row: Row) => products.find((product) => product.id === row.productId);
  const variantOf = (row: Row, color = row.color, size = row.size) =>
    color === undefined || size === undefined
      ? undefined
      : productOf(row)?.variants.find((v) => v.color === color && v.size === size);
  const quantityOf = (row: Row) => {
    const n = Number(row.quantity.trim());
    return Number.isInteger(n) && n >= 1 ? n : null;
  };

  // Stock still free for this line: what's on the shelf minus what other
  // lines of this same order already take.
  const freeFor = (variant: OrderVariant, self: Row) =>
    variant.stock -
    rows
      .filter((other) => other.key !== self.key && variantOf(other)?.id === variant.id)
      .reduce((sum, other) => sum + (quantityOf(other) ?? 0), 0);

  const update = (key: number, change: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...change };
        // A newly chosen item brings its own price.
        if (variantOf(next)?.id !== variantOf(row)?.id) {
          next.unitPrice = "";
          next.priceTyped = false;
        }
        return next;
      }),
    );

  // Multi-piece prices ("2 pieces = 99"). For each product, the pieces on
  // lines that use the product's own price are counted in order, across all
  // its colors and sizes: the first piece costs the full price and each one
  // after it adds what the product's price table says. A line with a price
  // typed by hand is left out of this.
  const offers = new Map<number, { net: number; product: string }>();
  const counted = new Map<string, { pieces: number; one: number }>();
  for (const row of rows) {
    const product = productOf(row);
    const variant = variantOf(row);
    const quantity = quantityOf(row);
    if (!product || !variant || quantity === null || row.priceTyped) continue;
    const tally = counted.get(product.id) ?? { pieces: 0, one: variant.price };
    let net = 0;
    for (let piece = 0; piece < quantity; piece++) {
      tally.pieces++;
      net += Math.round(Math.min(variant.price, pieceCost(tally.one, product, tally.pieces)) * 100);
    }
    counted.set(product.id, tally);
    offers.set(row.key, { net: net / 100, product: product.id });
  }

  const lines = rows.map((row) => {
    const product = productOf(row);
    const variant = variantOf(row);
    const quantity = quantityOf(row);
    const free = variant ? freeFor(variant, row) : 0;
    const usual = variant ? variant.price : null;
    const priceText = row.priceTyped ? row.unitPrice : usual !== null ? usual.toFixed(2) : "";
    const price = Number(priceText);
    const problem = !product
      ? null
      : !variant
        ? "choose"
        : free <= 0
          ? "out"
          : quantity === null
            ? "quantity"
            : quantity > free
              ? "short"
              : !priceText.trim() || !Number.isFinite(price) || price < 0
                ? "price"
                : null;
    // Other sizes and colors of the same product that can be sold right now.
    const others =
      product && variant && (problem === "out" || problem === "short")
        ? product.variants
            .filter((v) => v.id !== variant.id && freeFor(v, row) > 0)
            .sort(
              (a, b) =>
                Number(b.color === variant.color) - Number(a.color === variant.color) ||
                Number(b.size === variant.size) - Number(a.size === variant.size),
            )
            .slice(0, 6)
        : [];
    // What a multi-piece price takes off this line, and what the line comes to.
    const offer = offers.get(row.key);
    const full = (quantity ?? 0) * (Number.isFinite(price) ? price : 0);
    const discount =
      offer && !problem ? Math.max(0, Math.round((full - offer.net) * 100) / 100) : 0;
    return {
      row,
      product,
      variant,
      quantity,
      free,
      price,
      priceText,
      usual,
      problem,
      others,
      discount,
      lineTotal: Math.round((full - discount) * 100) / 100,
      offerPieces: offer ? (counted.get(offer.product)?.pieces ?? 0) : 0,
    };
  });

  const ready = lines.filter((line) => line.variant && !line.problem);

  // What is in the order, written out: "Linen Shirt - 1 XL Black, 2 M White".
  // Products in the order they were added; the same piece on two lines is
  // counted together.
  const contents = new Map<string, Map<string, { label: string; quantity: number }>>();
  for (const line of lines) {
    if (!line.product || !line.variant || line.quantity === null) continue;
    const pieces = contents.get(line.product.name) ?? new Map();
    const piece = pieces.get(line.variant.id) ?? {
      label: [line.variant.size, line.variant.color].filter(Boolean).join(" "),
      quantity: 0,
    };
    piece.quantity += line.quantity;
    pieces.set(line.variant.id, piece);
    contents.set(line.product.name, pieces);
  }
  const written = [...contents]
    .map(
      ([product, pieces]) =>
        `${product} - ${[...pieces.values()].map((piece) => [piece.quantity, piece.label].filter(Boolean).join(" ")).join(", ")}`,
    )
    .join("; ");
  const description = notesAuto ? written : notes;
  const blocked = lines.some((line) => line.problem);
  const subtotal = ready.reduce((sum, line) => sum + line.lineTotal, 0);
  const delivery = Number(shippingFee) || 0;
  const total = subtotal + delivery;
  // The COD follows the total until someone types a different amount.
  const codAmount = cod.trim() === "" ? total : Number(cod);
  const codWrong = !Number.isFinite(codAmount) || codAmount < 0;

  const hold = blocked
    ? "Fix the item marked in red before creating the order."
    : ready.length === 0
      ? "Add at least one product."
      : !shipperRef
        ? "Enter the FO number."
        : !customer.name.trim()
        ? "Enter the receiver's name."
        : !customer.phone.trim()
          ? "Enter mobile 1."
          : !customer.country || !customer.city || !customer.area
            ? "Choose the country, city and area."
            : codWrong
              ? "Enter the COD amount as a number."
              : refNow?.usedBy
                ? `${fullRef} is already used on another order.`
                : orderDate > today
                  ? "The order date can't be in the future."
                  : null;

  const findCustomer = () =>
    startLookup(async () => {
      const found = await lookupCustomer(customer.phone);
      if (!found) return setKnown(null);
      setCustomer((current) => ({
        ...current,
        name: current.name.trim() || found.name,
        phone2: current.phone2.trim() || found.phone2,
        country: found.country || current.country,
        city: current.city || found.city,
        area: current.area || found.area,
        street: current.street.trim() || found.street,
      }));
      setKnown(
        `Returning customer: ${found.name} · ${found.orders} earlier ${found.orders === 1 ? "order" : "orders"}`,
      );
    });

  const inUae = customer.country === DEFAULT_COUNTRY;
  const set = (change: Partial<Customer>) => setCustomer((current) => ({ ...current, ...change }));
  const sectionHead = "flex items-center gap-2.5 rounded-t-xl bg-brand-50 px-4 py-3";
  const th = "px-2 py-2.5 text-left text-[13px] font-semibold text-stone-800";
  const columns =
    "grid items-center gap-x-3 gap-y-2 md:grid-cols-[1.75rem_minmax(11rem,2fr)_minmax(10.5rem,1.4fr)_minmax(7rem,0.9fr)_8rem_minmax(7rem,1fr)_minmax(7rem,1fr)_2.5rem]";

  return (
    <form
      className="space-y-4"
      // Enter in a box must never create the order by accident: only the
      // Create Order button does.
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (hold || pending || leaving) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => run(data));
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {header}
        <label className="block w-full sm:w-52" data-order-date>
          <Label>Order Date</Label>
          <IconBox icon={CalendarDays} className={orderDate > today ? "border-rose-500" : ""}>
            <input
              type="date"
              aria-label="Order Date"
              value={orderDate || today}
              max={today}
              onChange={(event) =>
                setOrderDate(event.target.value === today ? "" : event.target.value)
              }
              className={inside + " font-semibold"}
            />
          </IconBox>
        </label>
      </div>

      {defaults.exchange && (
        <p
          data-exchange
          className="card flex flex-wrap items-center gap-2 border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900"
        >
          <Repeat className="size-4 shrink-0" />
          <span>
            <b>Exchange</b> for{" "}
            <Link href={`/orders/${defaults.exchange.id}`} className="font-semibold underline">
              {defaults.exchange.label}
            </Link>
            . Pick what the customer gets instead. The COD is the delivery charge the customer
            pays{defaults.exchange.courier ? ` ${defaults.exchange.courier}` : ""}: it stays with
            the delivery company, and anything less than their charge comes off your payout.
          </span>
        </p>
      )}

      {restored && (
        <p className="card flex flex-wrap items-center gap-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          You have an unfinished order from before. It&apos;s all still here.
          <button type="button" onClick={startOver} className="cursor-pointer font-semibold underline">
            Start over instead
          </button>
        </p>
      )}

      <input type="hidden" name="conversationId" value={defaults.conversationId} />
      <input type="hidden" name="source" value={defaults.source} />
      <input type="hidden" name="country" value={customer.country} />
      <input type="hidden" name="city" value={customer.city} />
      <input type="hidden" name="area" value={customer.area} />
      <input type="hidden" name="cod" value={codWrong ? "" : codAmount.toFixed(2)} />
      <input type="hidden" name="shipperRef" value={fullRef} />
      <input type="hidden" name="exchangeOf" value={defaults.exchange?.id ?? ""} />
      <input type="hidden" name="orderDate" value={orderDate} />
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(
          ready.map((line) => ({
            variantId: line.variant!.id,
            quantity: line.quantity,
            unitPrice: line.price,
            discount: line.discount,
          })),
        )}
      />

      {/* ---------- Customer & shipping ---------- */}
      <section className="card" data-customer>
        <header className={sectionHead}>
          <UserRound className="size-5 text-brand" strokeWidth={2} />
          <h2 className="text-base font-bold">Customer &amp; Shipping Details</h2>
        </header>
        <div className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <Label required>Shipper Ref</Label>
              <IconBox
                icon={Hash}
                className={refNow?.usedBy ? "border-rose-500" : ""}
              >
                <span className="flex items-center border-r border-stone-200 bg-stone-100 px-2.5 text-sm font-bold text-stone-700">
                  {REF_PREFIX}
                </span>
                <input
                  aria-label="Shipper Ref"
                  inputMode="numeric"
                  autoComplete="off"
                  value={shipperRef}
                  onChange={(event) => {
                    setRefAuto(false);
                    setShipperRef(event.target.value.replace(/\D/g, "").slice(0, 12));
                  }}
                  placeholder={nextRef}
                  className={inside + " font-semibold"}
                />
              </IconBox>
              {refNow?.usedBy && (
                <span data-ref-used className="mt-1 block text-xs font-semibold text-rose-700">
                  {fullRef} is already used on another order.{" "}
                  <Link href={`/orders/${refNow.usedBy.id}`} className="underline">
                    Open it
                  </Link>
                </span>
              )}
              {refNow && !refNow.usedBy && refNow.others.length > 0 && (
                <span
                  data-ref-others
                  role="alert"
                  className="mt-1 block rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900"
                >
                  {refNow.others.join(" and ")} {refNow.others.length === 1 ? "is" : "are"} also
                  filling an order with {fullRef} right now. Check with{" "}
                  {refNow.others.length === 1 ? "them" : "each other"} who is doing it.
                </span>
              )}
            </label>
            <label className="block">
              <Label required>Receiver Name</Label>
              <IconBox icon={User}>
                <input
                  name="name"
                  value={customer.name}
                  onChange={(event) => set({ name: event.target.value })}
                  placeholder="Receiver Name"
                  className={inside}
                />
              </IconBox>
            </label>
            <label className="block">
              <Label required>Mobile 1</Label>
              <IconBox icon={Smartphone}>
                <input
                  name="phone"
                  inputMode="tel"
                  value={customer.phone}
                  onChange={(event) => set({ phone: event.target.value })}
                  onBlur={findCustomer}
                  placeholder="Mobile Number"
                  className={inside}
                />
              </IconBox>
              {known && <span className="mt-1 block text-xs text-emerald-700">{known}</span>}
            </label>
            <label className="block">
              <Label>Mobile 2 (Optional)</Label>
              <IconBox icon={Smartphone}>
                <input
                  name="phone2"
                  inputMode="tel"
                  value={customer.phone2}
                  onChange={(event) => set({ phone2: event.target.value })}
                  placeholder="Alternate Number"
                  className={inside}
                />
              </IconBox>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_2fr]">
            <label className="block">
              <Label required>COD</Label>
              <IconBox icon={Hash} className={codWrong ? "border-rose-500" : ""}>
                <input
                  aria-label="COD"
                  inputMode="decimal"
                  value={cod}
                  onChange={(event) => setCod(event.target.value)}
                  placeholder={total > 0 ? total.toFixed(2) : "COD Amount (AED)"}
                  className={inside}
                />
              </IconBox>
              <span
                className={
                  "mt-1 block text-xs " +
                  (codWrong ? "font-semibold text-rose-700" : "text-stone-500")
                }
              >
                {cod.trim() === ""
                  ? "Follows the order total. Type 0 if it is already paid."
                  : codWrong
                    ? "Enter a number."
                    : `Collect ${formatMoney(codAmount, currency)} on delivery.`}
              </span>
            </label>
            <div>
              <Label>Instruction</Label>
              <SuggestInput
                icon={Quote}
                name="instruction"
                label="Instruction"
                value={instruction}
                options={instructions}
                placeholder="Instruction for the delivery (optional)"
                onChange={setInstruction}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.4fr]">
            <label className="block">
              <Label required>Country</Label>
              <IconBox icon={Globe}>
                <span className="relative flex min-w-0 flex-1">
                  <select
                    aria-label="Country"
                    value={customer.country}
                    onChange={(event) => set({ country: event.target.value, city: "", area: "" })}
                    className={selectInside}
                  >
                    {COUNTRIES.map((country) => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                  <Arrow />
                </span>
              </IconBox>
            </label>
            <label className="block">
              <Label required>City</Label>
              <IconBox icon={MapPin}>
                <PlaceField
                  label="City"
                  placeholder="Choose City"
                  value={customer.city}
                  options={inUae ? UAE_CITIES : null}
                  onChange={(city) => set({ city, area: "" })}
                />
              </IconBox>
            </label>
            <div>
              <Label required>Area</Label>
              {inUae ? (
                <SearchSelect
                  icon={MapPin}
                  label="Area"
                  placeholder="Choose Area"
                  value={customer.area}
                  options={UAE_AREAS[customer.city] ?? []}
                  emptyText={
                    customer.city
                      ? "No area matches. Type its name to add it."
                      : "Choose the city first, or type the area's name."
                  }
                  onChange={(area) => set({ area })}
                />
              ) : (
                <IconBox icon={MapPin}>
                  <PlaceField
                    label="Area"
                    placeholder="Choose Area"
                    value={customer.area}
                    options={null}
                    onChange={(area) => set({ area })}
                  />
                </IconBox>
              )}
            </div>
            <label className="block">
              <Label>Street Address</Label>
              <IconBox icon={Building2}>
                <input
                  name="street"
                  value={customer.street}
                  onChange={(event) => set({ street: event.target.value })}
                  placeholder="Street Address, Building, Apartment, etc."
                  className={inside}
                />
              </IconBox>
            </label>
          </div>
        </div>
      </section>

      {/* ---------- Order items ---------- */}
      <section className="card" data-items>
        <header className={sectionHead + " rounded-t-xl"}>
          <span className="flex items-center gap-2.5">
            <Package className="size-5 text-brand" strokeWidth={2} />
            <h2 className="text-base font-bold">Order Items</h2>
          </span>
        </header>

        {products.length === 0 ? (
          <p className="p-4 text-sm text-stone-600">
            You have no products yet. Add products first, then take the order.
          </p>
        ) : (
          <div className="px-4 pt-1 pb-4">
            <div className={columns + " border-b border-stone-100 max-md:hidden"}>
              <span className={th + " text-center"}>#</span>
              <span className={th}>
                Product <span className="text-rose-600">*</span>
              </span>
              <span className={th}>
                Color <span className="text-rose-600">*</span>
              </span>
              <span className={th}>
                Size <span className="text-rose-600">*</span>
              </span>
              <span className={th + " text-center"}>
                Quantity <span className="text-rose-600">*</span>
              </span>
              <span className={th + " text-center"}>Unit Price ({currency})</span>
              <span className={th + " text-center"}>Total ({currency})</span>
              <span />
            </div>

            <div className="mt-2 space-y-2">
              {lines.map((line, index) => {
                const { row, product, variant, quantity, free, price, priceText, usual } = line;
                const { problem, others, discount, lineTotal, offerPieces } = line;
                const red = problem === "out" || problem === "short";
                return (
                  <div
                    key={row.key}
                    data-line
                    className={"rounded-lg " + (red ? "bg-rose-50 p-2 ring-1 ring-rose-200" : "")}
                  >
                    <div className={columns}>
                      <span className="text-center text-sm font-semibold max-md:hidden">
                        {index + 1}
                      </span>

                      <div className="flex min-w-0 items-center gap-2">
                        <span className="size-10 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
                          {product?.photo && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.photo} alt="" className="size-full object-cover" />
                          )}
                        </span>
                        <ProductPicker
                          products={products}
                          value={row.productId}
                          onPick={(picked) =>
                            update(row.key, {
                              productId: picked.id,
                              // One color (or size) only: nothing to choose.
                              color: picked.colors.length === 1 ? picked.colors[0] : undefined,
                              size: picked.sizes.length === 1 ? picked.sizes[0] : undefined,
                            })
                          }
                        />
                      </div>

                      {(["color", "size"] as const).map((part) => {
                        const options = product ? (part === "color" ? product.colors : product.sizes) : [];
                        const chosen = row[part];
                        const single = options.length === 1;
                        const isColor = part === "color";
                        return (
                          <span
                            key={part}
                            className={
                              "relative flex h-10 items-center rounded-lg border border-stone-200 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand " +
                              (!product || single ? "bg-stone-100" : "bg-white")
                            }
                          >
                            {isColor && (
                              <span
                                className="ml-3 size-4 shrink-0 rounded-full border border-stone-300"
                                style={{
                                  backgroundColor:
                                    typeof chosen === "string" ? colorDot(chosen) : "transparent",
                                }}
                              />
                            )}
                            <select
                              aria-label={isColor ? "Color" : "Size"}
                              disabled={!product || single}
                              value={chosen === undefined ? "" : String(options.indexOf(chosen))}
                              onChange={(event) =>
                                update(row.key, {
                                  [part]:
                                    event.target.value === ""
                                      ? undefined
                                      : options[Number(event.target.value)],
                                })
                              }
                              className={
                                "h-full min-w-0 flex-1 cursor-pointer appearance-none bg-transparent pr-8 text-sm font-semibold outline-none disabled:cursor-default " +
                                (isColor ? "pl-2.5" : "pl-3")
                              }
                            >
                              {!single && <option value="">{isColor ? "Color" : "Size"}</option>}
                              {options.map((option, optionIndex) => {
                                // Show how many are left for each choice.
                                const matching = product!.variants.filter((v) =>
                                  isColor
                                    ? v.color === option && (row.size === undefined || v.size === row.size)
                                    : v.size === option && (row.color === undefined || v.color === row.color),
                                );
                                const count = matching.reduce(
                                  (sum, v) => sum + Math.max(0, freeFor(v, row)),
                                  0,
                                );
                                return (
                                  <option key={String(option)} value={optionIndex}>
                                    {option === null
                                      ? isColor
                                        ? "One color"
                                        : "One size"
                                      : `${option} — ${matching.length ? left(count) : "not made"}`}
                                  </option>
                                );
                              })}
                            </select>
                            <Arrow />
                          </span>
                        );
                      })}

                      <div className="flex h-10 overflow-hidden rounded-lg border border-stone-200 bg-white">
                        <button
                          type="button"
                          aria-label="One less"
                          onClick={() =>
                            update(row.key, { quantity: String(Math.max(1, (quantity ?? 1) - 1)) })
                          }
                          className="flex w-9 cursor-pointer items-center justify-center text-stone-700 hover:bg-stone-100"
                        >
                          <Minus className="size-4" />
                        </button>
                        <input
                          aria-label="Quantity"
                          inputMode="numeric"
                          value={row.quantity}
                          onChange={(event) => update(row.key, { quantity: event.target.value })}
                          className="w-full min-w-0 border-x border-stone-200 text-center text-sm font-semibold tabular-nums outline-none focus:bg-brand-50"
                        />
                        <button
                          type="button"
                          aria-label="One more"
                          onClick={() => update(row.key, { quantity: String((quantity ?? 0) + 1) })}
                          className="flex w-9 cursor-pointer items-center justify-center text-stone-700 hover:bg-stone-100"
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>

                      <span className="flex h-10 items-center gap-1 rounded-lg border border-stone-200 bg-stone-100 px-3 text-sm font-semibold tabular-nums focus-within:border-brand focus-within:bg-white">
                        <span className="ml-auto">{currency}</span>
                        <input
                          aria-label="Unit Price"
                          inputMode="decimal"
                          value={priceText}
                          placeholder="0.00"
                          onChange={(event) =>
                            update(row.key, { unitPrice: event.target.value, priceTyped: true })
                          }
                          style={{ width: `${Math.max(4, priceText.length || 4)}ch` }}
                          className="bg-transparent text-right font-semibold outline-none"
                        />
                      </span>

                      <span
                        data-line-total
                        className="text-center text-base font-extrabold text-brand tabular-nums"
                      >
                        {variant && !problem ? formatMoney(lineTotal, currency) : "—"}
                      </span>

                      <button
                        type="button"
                        aria-label="Remove item"
                        title="Remove this product"
                        onClick={() =>
                          setRows((current) =>
                            current.length === 1
                              ? [blank(row.key + 1)]
                              : current.filter((r) => r.key !== row.key),
                          )
                        }
                        className="flex size-9 cursor-pointer items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    {/* What the stock says about this line. */}
                    {problem === "choose" && (
                      <p className="mt-1.5 text-xs text-stone-500 md:pl-10">
                        Choose the color and size.
                      </p>
                    )}
                    {variant && problem === "out" && (
                      <p role="alert" className="mt-2 text-sm font-semibold text-rose-800 md:pl-10">
                        Out of stock — can&apos;t be ordered.
                        <span className="font-normal">
                          {" "}
                          {product!.name} · {variantLabel(variant)} has none left.
                        </span>
                      </p>
                    )}
                    {variant && problem === "short" && (
                      <p role="alert" className="mt-2 text-sm font-semibold text-rose-800 md:pl-10">
                        Only {free} left — can&apos;t order {quantity}.{" "}
                        <button
                          type="button"
                          onClick={() => update(row.key, { quantity: String(free) })}
                          className="cursor-pointer font-semibold underline"
                        >
                          Order {free} instead
                        </button>
                      </p>
                    )}
                    {red && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-stone-700 md:pl-10">
                        {others.length ? (
                          <>
                            In stock instead:
                            {others.map((other) => (
                              <button
                                key={other.id}
                                type="button"
                                onClick={() =>
                                  update(row.key, { color: other.color, size: other.size })
                                }
                                className="cursor-pointer rounded-md border border-stone-300 bg-white px-1.5 py-0.5 font-semibold hover:bg-stone-100"
                              >
                                {variantLabel(other)} · {freeFor(other, row)} left
                              </button>
                            ))}
                          </>
                        ) : (
                          problem === "out" && "Nothing else of this product is in stock either."
                        )}
                      </div>
                    )}
                    {problem === "quantity" && (
                      <p className="mt-1.5 text-xs text-rose-700 md:pl-10">
                        Quantity must be a whole number, 1 or more.
                      </p>
                    )}
                    {problem === "price" && (
                      <p className="mt-1.5 text-xs text-rose-700 md:pl-10">Enter a price.</p>
                    )}
                    {variant && !problem && (
                      <p className="mt-1 text-xs text-emerald-700 md:pl-10">
                        In stock: {free} · {free - quantity!} left after this order
                        <span className="text-stone-400"> · {variant.sku}</span>
                        {discount > 0 && (
                          <span data-tier className="font-semibold text-brand">
                            {" "}
                            · {offerPieces}-piece price: {formatMoney(discount, currency)} off
                          </span>
                        )}
                      </p>
                    )}
                    {variant && usual !== null && row.priceTyped && price !== usual && (
                      <p className="mt-1 text-xs text-stone-500 md:pl-10">
                        Your own price.{" "}
                        <button
                          type="button"
                          onClick={() => update(row.key, { unitPrice: "", priceTyped: false })}
                          className="cursor-pointer font-semibold text-brand underline"
                        >
                          Use the usual {formatMoney(usual, currency)}
                        </button>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {/* One more item, starting from the product of the line above. */}
            <button
              type="button"
              data-add-item
              aria-label="Add another item"
              title="Add another item"
              onClick={() =>
                setRows((current) => {
                  const above = products.find(
                    (product) => product.id === current[current.length - 1]?.productId,
                  );
                  return [
                    ...current,
                    {
                      ...blank(Math.max(...current.map((row) => row.key)) + 1),
                      productId: above?.id ?? "",
                      // One color (or size) only: nothing to choose.
                      color: above?.colors.length === 1 ? above.colors[0] : undefined,
                      size: above?.sizes.length === 1 ? above.sizes[0] : undefined,
                    },
                  ];
                })
              }
              className="mt-3 inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-brand bg-white text-brand hover:bg-brand-50"
            >
              <Plus className="size-5" strokeWidth={2.4} />
            </button>
          </div>
        )}
      </section>

      {/* ---------- Summary and buttons ---------- */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-64 flex-1 space-y-3">
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Clear this order and start again?")) startOver();
            }}
            className="btn-secondary h-11 px-4"
          >
            <Trash2 className="size-4" /> Clear Order
          </button>
          <label className="block" data-description>
            <Label>Description</Label>
            <textarea
              name="notes"
              aria-label="Description"
              rows={2}
              value={description}
              onChange={(event) => {
                setNotes(event.target.value);
                setNotesAuto(false);
              }}
              placeholder="Fills in by itself once the items are chosen"
              className="input min-h-16 w-full resize-y py-2 leading-snug"
            />
            {/* Left as written from the items, nothing extra is saved: the
                order's description then always follows its items. */}
            <input type="hidden" name="notesAuto" value={notesAuto ? "1" : ""} />
            <span className="mt-1 block text-xs text-stone-500">
              {notesAuto ? (
                "Written from the items. Type here to use your own words."
              ) : (
                <>
                  Your own words.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setNotes("");
                      setNotesAuto(true);
                    }}
                    className="cursor-pointer font-semibold text-brand underline"
                  >
                    Write it from the items again
                  </button>
                </>
              )}
            </span>
          </label>
        </div>

        <div className="card ml-auto w-full max-w-md p-3 text-sm" data-summary>
          <dl className="tabular-nums">
            <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
              <dt className="font-semibold">Items</dt>
              <dd data-summary-items className="font-semibold">
                {ready.length}
              </dd>
            </div>
            <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
              <dt className="font-semibold">Subtotal</dt>
              <dd data-summary-subtotal>{formatMoney(subtotal, currency)}</dd>
            </div>
            <div className="flex items-center justify-between px-3 py-1.5">
              <dt className="font-semibold">Delivery</dt>
              <dd>
                <span className="flex h-8 w-28 items-center gap-1 rounded-lg border border-stone-200 px-2 focus-within:border-brand focus-within:ring-1 focus-within:ring-brand">
                  <span className="ml-auto text-stone-900">{currency}</span>
                  <input
                    name="shippingFee"
                    aria-label="Delivery"
                    inputMode="decimal"
                    value={shippingFee}
                    placeholder="0.00"
                    onChange={(event) => setShippingFee(event.target.value)}
                    style={{ width: `${Math.max(4, shippingFee.length || 4)}ch` }}
                    className="bg-transparent text-right outline-none"
                  />
                </span>
              </dd>
            </div>
            <div className="mt-1 flex items-center justify-between rounded-lg bg-brand-100 px-3 py-2.5 text-lg font-extrabold text-brand-700">
              <dt>Total (COD)</dt>
              <dd data-order-total>{formatMoney(codWrong ? total : codAmount, currency)}</dd>
            </div>
          </dl>
        </div>

        <div className="w-full sm:w-auto">
          <button
            type="submit"
            disabled={pending || leaving || hold !== null}
            className="inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl bg-brand px-8 text-lg font-bold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Check className="size-5" strokeWidth={2.6} />
            {pending || leaving ? "Creating…" : "Create Order"}
          </button>
          {state?.error && (
            <p role="alert" className="mt-2 max-w-64 text-sm font-semibold text-rose-700">
              {state.error}
            </p>
          )}
          {hold && (
            <p
              data-hold
              className={
                "mt-2 max-w-64 text-xs " + (blocked ? "font-semibold text-rose-700" : "text-stone-500")
              }
            >
              {hold}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
