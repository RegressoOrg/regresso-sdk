import Link from "next/link";
import type { Product } from "@/lib/products";

export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="card">
      <h2>
        <Link href={`/products/${product.slug}`}>{product.name}</Link>
      </h2>
      <p>{product.blurb}</p>
      <p>${product.price}</p>
    </article>
  );
}
