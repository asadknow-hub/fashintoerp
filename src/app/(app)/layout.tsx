import { Suspense } from "react";
import { logout } from "@/app/auth-actions";
import { Nav } from "@/components/nav";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { SubmitButton } from "@/components/submit-button";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="min-h-screen md:flex">
      <aside className="z-20 border-b border-stone-200 bg-stone-100 px-2 py-2 md:sticky md:top-0 md:flex md:h-screen md:w-44 md:shrink-0 md:flex-col md:self-start md:border-r md:border-b-0 md:py-3">
        <div className="mb-2 px-2.5 text-base font-semibold tracking-tight md:mb-3">
          <Suspense fallback="ERP">
            <BusinessName />
          </Suspense>
        </div>
        <Suspense
          fallback={
            <Suspense>
              <Nav />
            </Suspense>
          }
        >
          <UserNav />
        </Suspense>
        <div className="mt-2 flex items-center justify-between gap-2 px-2.5 md:mt-auto md:block">
          <p className="truncate text-xs text-stone-500">
            <Suspense>
              <UserName />
            </Suspense>
          </p>
          <form action={logout}>
            <SubmitButton
              className="cursor-pointer text-xs font-medium text-stone-700 underline-offset-2 hover:underline disabled:opacity-50 md:mt-1"
              working="Signing out…"
            >
              Sign out
            </SubmitButton>
          </form>
          {/* Shows which version of the app is live, to make support easier. */}
          <p className="text-[10px] text-stone-400 max-md:hidden md:mt-2">
            Version {process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev"}
          </p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-3 py-3 md:px-5 md:py-4">{children}</main>
    </div>
  );
}

// The Staff link only shows for owners.
async function UserNav() {
  const user = await requireUser();
  return <Nav owner={user.role === "owner"} />;
}

async function BusinessName() {
  await requireUser();
  return (await getSettings())?.businessName ?? "ERP";
}

async function UserName() {
  const user = await requireUser();
  return user.name;
}
