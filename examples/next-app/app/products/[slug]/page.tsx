import { notFound } from "next/navigation";
import { AddToCart } from "@/components/add-to-cart";
import { ProductGallery } from "@/components/product-gallery";
import { PromoBanner } from "@/components/promo-banner";
import { Reviews } from "@/components/reviews";
import { getProduct, products } from "@/lib/products";

export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const product = getProduct((await params).slug);
  if (!product) notFound();
  return (
    <>
      <PromoBanner />
      <main>
        <ProductGallery name={product.name} />
        <h1>{product.name}</h1>
        <p>{product.blurb}</p>
        <AddToCart slug={product.slug} price={product.price} />
        <Reviews reviews={product.reviews} />
      </main>
    </>
  );
}
