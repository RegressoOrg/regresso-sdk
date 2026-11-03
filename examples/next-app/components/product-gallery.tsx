import { regress } from "@/lib/regressions";

export function ProductGallery({ name }: { name: string }) {
  return (
    <figure style={{ margin: 0 }}>
      {/* biome-ignore lint/performance/noImgElement: a plain img keeps the LCP element simple */}
      <img
        className="hero"
        src="/hero.svg"
        alt={name}
        width={1200}
        height={600}
        loading={regress.lcp ? "lazy" : "eager"}
        fetchPriority={regress.lcp ? "low" : "high"}
      />
    </figure>
  );
}
