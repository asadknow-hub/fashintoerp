import { ProductList } from "../inventory/product-list";

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  return <ProductList params={await searchParams} layout="gallery" />;
}
