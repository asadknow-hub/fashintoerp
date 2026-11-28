// Where the database lives, as the app should connect to it.
//
// Supabase's shared pooler answers on two ports of the same address. On 5432
// every connection keeps a database connection of its own for as long as it
// stays open, and only about 15 fit, which a website runs out of as soon as
// a few copies of it are awake. On 6543 a database connection is only
// borrowed for the length of each request, so hundreds fit. An address that
// points at the first is switched to the second here.
// Whether to ask for an encrypted connection. A database on this same
// machine (development, tests) needs none, and an address that already says
// what it wants is left to say it. Everything else is asked to encrypt:
// customers' names, phones and addresses travel over this connection.
// ("prefer" encrypts whenever the database can, which Supabase always can,
// and still connects in the odd case where one cannot.)
export function databaseSsl(): "prefer" | undefined {
  try {
    const url = new URL(databaseUrl());
    if (url.searchParams.has("sslmode") || url.searchParams.has("ssl")) return undefined;
    if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return undefined;
    return "prefer";
  } catch {
    return undefined;
  }
}

export function databaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("DATABASE_URL is not set. See README.md.");
  }
  try {
    const url = new URL(raw);
    if (url.hostname.endsWith(".pooler.supabase.com") && (url.port === "5432" || url.port === "")) {
      url.port = "6543";
      return url.toString();
    }
  } catch {
    // Not an address we can read; the database driver will say so.
  }
  return raw;
}
