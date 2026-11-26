import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { mediaMode, mediaOffReason } from "@/lib/media";
import { ProductCreator } from "./product-creator";

export default async function NewProductPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Add product"
        subtitle="Add its photos, pick the sizes and colors, and type the stock into the grid."
      />
      <ProductCreator mode={mediaMode()} offReason={mediaOffReason()} />
    </>
  );
}
