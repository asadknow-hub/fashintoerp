import { FreshOnVisit } from "@/components/fresh-on-visit";
import { PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { mediaMode, mediaOffReason } from "@/lib/media";
import { getPrefs } from "@/lib/settings";
import { ProductCreator } from "./product-creator";

export default async function NewProductPage() {
  // Adding products is for Owners and the System Admin.
  const [user, { currency }] = await Promise.all([requireOwner(), getPrefs()]);
  return (
    <>
      <PageHeader
        title="Add product"
        subtitle="Add its photos, pick the sizes and colors, and type the stock into the grid."
      />
      <FreshOnVisit>
        <ProductCreator
          userId={user.id}
          mode={mediaMode()}
          offReason={mediaOffReason()}
          currency={currency}
        />
      </FreshOnVisit>
    </>
  );
}
