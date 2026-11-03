"use client";

import { useState } from "react";
import { busyWait, regress } from "@/lib/regressions";

export function AddToCart({ slug, price }: { slug: string; price: number }) {
  const [count, setCount] = useState(0);
  return (
    <div className="card">
      <p>${price}</p>
      <button
        type="button"
        data-slug={slug}
        onClick={() => {
          if (regress.inp) busyWait(250);
          setCount((c) => c + 1);
        }}
      >
        Add to cart{count ? ` (${count})` : ""}
      </button>
    </div>
  );
}
