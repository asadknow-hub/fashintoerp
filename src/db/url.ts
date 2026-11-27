// Where the database lives, as the app should connect to it.
//
// Supabase's shared pooler answers on two ports of the same address. On 5432
// every connection keeps a database connection of its own for as long as it
// stays open, and only about 15 fit, which a website runs out of as soon as
// a few copies of it are awake. On 6543 a database connection is only
// borrowed for the length of each request, so hundreds fit. An address that
// points at the first is switched to the second here.
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
