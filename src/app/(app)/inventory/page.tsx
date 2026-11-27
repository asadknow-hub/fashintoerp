import { ProductList } from "./product-list";

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  return <ProductList params={await searchParams} layout="table" />;
}
