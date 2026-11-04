// Lives in a route group, so its route template is /about: the manifest strips "(info)".
export default function AboutPage() {
  return (
    <main className="about">
      <h1>About</h1>
      <p>A fixture shop for the Regresso SDK.</p>
    </main>
  );
}
