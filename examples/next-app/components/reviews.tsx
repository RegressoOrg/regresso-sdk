import type { Product } from "@/lib/products";

function Stars({ n }: { n: number }) {
  return (
    <span role="img" aria-label={`${n} stars`}>
      {"★".repeat(n)}
    </span>
  );
}

export function Reviews({ reviews }: { reviews: Product["reviews"] }) {
  if (!reviews.length) return <p>No reviews yet.</p>;
  return (
    <section>
      <h2>Reviews</h2>
      <ul>
        {reviews.map((r) => (
          <li key={r.author + r.text}>
            <Stars n={r.stars} /> {r.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
