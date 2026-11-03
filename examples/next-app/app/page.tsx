import { ProductCard } from "@/components/product-card";
import { products } from "@/lib/products";

// A server component: no "use client", async, renders other server components.
export default async function HomePage() {
  const items = await Promise.resolve(products);
  return (
    <main>
      <h1>Coffee gear</h1>
      <div className="grid">
        {items.map((p) => (
          <ProductCard key={p.slug} product={p} />
        ))}
      </div>
    </main>
  );
}
