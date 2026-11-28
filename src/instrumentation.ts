import type { Instrumentation } from "next";

// Every error the server meets (a page that failed to load, a save that
// crashed) is written into the error log, so the System Admin can see that
// something went wrong and when, without anyone having to report it.
export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest?: unknown }).digest)
      : null;
  // Being sent to another page, or a page that does not exist, is no error.
  if (digest && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(digest)) return;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Server error on ${request.method} ${request.path}:`, error);
  try {
    const { logError } = await import("@/lib/error-log");
    await logError({ path: `${request.method} ${request.path}`, message, digest });
  } catch (err) {
    // The database itself may be what is failing; the line above is on the
    // hosting platform's own log either way.
    console.error("Could not write to the error log:", err);
  }
};
