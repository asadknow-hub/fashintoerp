import { redirect } from "next/navigation";

// "Purchases" is now part of Accounts: the stock that was bought is listed
// there with every other transaction. Old links land in the right place.
export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const params = await searchParams;
  redirect(params.view === "missing" ? "/accounts?kind=missing" : "/accounts?kind=stock");
}
