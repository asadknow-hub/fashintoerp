export function formatMoney(value: string | number | null, currency: string) {
  const amount = Number(value ?? 0);
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return currency + " " + amount.toFixed(2);
  }
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
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
