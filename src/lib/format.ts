// The one currency the whole system works in.
export const CURRENCY = "AED";

// What an order is called: its FO number, which is how the business knows
// it. Only an order saved without one falls back to the system's own number.
export const orderName = (ref: string | null | undefined, number: number) =>
  ref?.trim() || `#${number}`;

// Money as it is shown everywhere: "AED 1,250.00".
export function formatMoney(value: string | number | null, currency: string = CURRENCY) {
  const amount = Number(value ?? 0);
  const number = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
  return `${currency} ${number}`;
}

export function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const safeZone = (value: string) => (isTimeZone(value) ? value : "UTC");

export function formatDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: safeZone(timeZone),
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: safeZone(timeZone),
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function variantLabel(v: { size: string | null; color: string | null }) {
  return [v.size, v.color].filter(Boolean).join(" / ") || "One size";
}

// Small helpers for reading form fields safely.
export function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function optional(form: FormData, key: string) {
  return text(form, key) || null;
}

export function wholeNumber(form: FormData, key: string) {
  const raw = text(form, key);
  const n = Number(raw);
  return raw !== "" && Number.isInteger(n) ? n : NaN;
}

// Money from a form field, as a string like "12.50". Null when invalid.
export function amount(form: FormData, key: string) {
  const raw = text(form, key);
  if (!raw) return "0";
  const n = Number(raw);
  // Capped well above any real amount, and below what the database can hold.
  return Number.isFinite(n) && n >= 0 && n <= 99_999_999 ? n.toFixed(2) : null;
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

const SIZE_ORDER = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "5XL"];

// Puts clothing sizes in the order people expect (S, M, L…), numbers lowest
// first, and anything else in the order it was added.
export function sortSizes<T extends string | null>(sizes: T[]): T[] {
  const rank = (size: T, index: number) => {
    if (size === null) return [3, index];
    const known = SIZE_ORDER.indexOf(size.toUpperCase());
    if (known >= 0) return [0, known];
    const number = Number(size);
    if (size.trim() !== "" && Number.isFinite(number)) return [1, number];
    return [2, index];
  };
  return sizes
    .map((size, index) => ({ size, key: rank(size, index) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])
    .map((entry) => entry.size);
}

// Phone numbers are compared without spaces, dashes or brackets, so
// "0300 123-4567" and "03001234567" are the same customer.
export function cleanPhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? "+" + digits.slice(1).replace(/\+/g, "") : digits.replace(/\+/g, "");
}
