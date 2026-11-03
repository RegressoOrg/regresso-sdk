"use client";

import { useEffect, useState } from "react";
import { regress } from "@/lib/regressions";

export function PromoBanner() {
  const [show, setShow] = useState(!regress.cls);
  useEffect(() => {
    if (!regress.cls) return;
    const t = setTimeout(() => setShow(true), 600);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return <aside className="promo">Free shipping this week.</aside>;
}
