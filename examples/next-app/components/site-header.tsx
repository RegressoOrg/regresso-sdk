import Link from "next/link";

export function SiteHeader() {
  return (
    <header>
      <Link href="/">
        <strong>Example shop</strong>
      </Link>
      <nav>
        <Link href="/products/espresso-machine">Espresso machine</Link>
      </nav>
    </header>
  );
}
