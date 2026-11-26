import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Quick first check: no session cookie means go to the sign-in page.
// The real check (is the session valid?) happens in every page and action.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|setup|recover|api|_next/static|_next/image|favicon.ico).*)"],
};
