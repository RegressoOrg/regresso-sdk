import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPONENT_ID_RE, validateBuildUpload } from "@regresso/protocol";
import { describe, expect, it } from "vitest";
import {
  componentId,
  contentHash,
  makeBuildId,
  transformJsx,
  writeManifest,
} from "../src/index.js";

const FILE = "app/products/add-to-cart.tsx";

function run(code: string, file = FILE) {
  return transformJsx(code, { file, filename: `/repo/${file}` });
}

/** Transformed code with ids replaced by the component name, for readable assertions. */
function tagged(code: string, file = FILE): string | null {
  const r = run(code, file);
  if (!r) return null;
  let out = r.code;
  for (const c of r.components) out = out.replaceAll(`"${c.id}"`, `{${c.name}}`);
  return out;
}

describe("componentId", () => {
  it("is 8 base36 chars that satisfy the protocol format", () => {
    const id = componentId(FILE, "AddToCart");
    expect(id).toMatch(/^[0-9a-z]{8}$/);
    expect(COMPONENT_ID_RE.test(id)).toBe(true);
  });

  it("is a pure function of (file, name)", () => {
    expect(componentId(FILE, "AddToCart")).toBe(componentId(FILE, "AddToCart"));
    expect(componentId(FILE, "AddToCart")).not.toBe(componentId(FILE, "AddToCartButton"));
    expect(componentId(FILE, "AddToCart")).not.toBe(componentId("app/cart.tsx", "AddToCart"));
    // the separator keeps (a, bc) and (ab, c) apart
    expect(componentId("a", "bc")).not.toBe(componentId("ab", "c"));
  });

  it("pins the hash so a change to the id scheme is deliberate", () => {
    // If this fails, every component id in every customer's history changes. Don't.
    expect(componentId("app/page.tsx", "default")).toMatchInlineSnapshot(`"9459vufy"`);
    expect(componentId(FILE, "AddToCart")).toMatchInlineSnapshot(`"4rem0pql"`);
  });

  it("does not collide across 50k synthetic components", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50_000; i++) ids.add(componentId(`src/c${i % 500}.tsx`, `C${i}`));
    expect(ids.size).toBe(50_000);
  });
});

describe("transformJsx", () => {
  it("tags function declarations, arrows and default exports", () => {
    const src = `
export default function Page() {
  return <main className="p"><h1>Hi</h1></main>;
}
export const Card = ({ title }: { title: string }) => <section>{title}</section>;
function Inner() { return (<div />); }
`;
    expect(tagged(src)).toBe(`
export default function Page() {
  return <main data-cwv={Page} className="p"><h1>Hi</h1></main>;
}
export const Card = ({ title }: { title: string }) => <section data-cwv={Card}>{title}</section>;
function Inner() { return (<div data-cwv={Inner} />); }
`);
  });

  it("tags async server components", () => {
    const src = `export default async function Page() {
  const data = await fetch("x").then((r) => r.json());
  return <article>{data.title}</article>;
}`;
    expect(tagged(src)).toContain(`<article data-cwv={Page}>`);
  });

  it("names anonymous default exports 'default'", () => {
    expect(run("export default () => <div />")?.components[0]?.name).toBe("default");
    expect(run("export default function () { return <div /> }")?.components[0]?.name).toBe(
      "default",
    );
  });

  it("unwraps memo, forwardRef and React.memo", () => {
    const src = `
const A = memo(() => <div />);
const B = React.forwardRef((p, ref) => <input ref={ref} />);
const C = memo(forwardRef(function C(p, r) { return <span /> }));
export default memo(function Named() { return <p /> });
`;
    expect(tagged(src)).toBe(`
const A = memo(() => <div data-cwv={A} />);
const B = React.forwardRef((p, ref) => <input data-cwv={B} ref={ref} />);
const C = memo(forwardRef(function C(p, r) { return <span data-cwv={C} /> }));
export default memo(function Named() { return <p data-cwv={Named} /> });
`);
  });

  it("tags each child of a fragment", () => {
    const src = "function List() { return <><h2 /><ul /></> }";
    expect(tagged(src)).toBe(
      "function List() { return <><h2 data-cwv={List} /><ul data-cwv={List} /></> }",
    );
  });

  it("descends through other components to the outermost host elements", () => {
    const src = `function Page() {
  return <Layout title={<b>not this</b>}><Suspense><main /></Suspense><Header /></Layout>;
}`;
    expect(tagged(src)).toBe(`function Page() {
  return <Layout title={<b>not this</b>}><Suspense><main data-cwv={Page} /></Suspense><Header /></Layout>;
}`);
  });

  it("tags every return, including conditionals and logical expressions", () => {
    const src = `function Price({ p, sale }) {
  if (!p) return null;
  if (sale) return sale && <s />;
  return p > 10 ? <b /> : <i />;
}`;
    expect(tagged(src)).toBe(`function Price({ p, sale }) {
  if (!p) return null;
  if (sale) return sale && <s data-cwv={Price} />;
  return p > 10 ? <b data-cwv={Price} /> : <i data-cwv={Price} />;
}`);
  });

  it("ignores returns of nested functions and map callbacks", () => {
    const src = `function Grid({ items }) {
  const render = () => <li />;
  return <ul>{items.map((i) => <li key={i} />)}</ul>;
}`;
    expect(tagged(src)).toBe(`function Grid({ items }) {
  const render = () => <li />;
  return <ul data-cwv={Grid}>{items.map((i) => <li key={i} />)}</ul>;
}`);
  });

  it("skips lowercase functions, non-JSX functions and components rendering only components", () => {
    const src = `
function helper() { return <div /> }
const useThing = () => 1;
const Config = { a: 1 };
function Wrapper({ children }) { return <Provider>{children}</Provider> }
export function Real() { return <div /> }
`;
    const r = run(src);
    expect(r?.components.map((c) => c.name)).toEqual(["Real"]);
    expect(r?.code).toContain("function helper() { return <div /> }");
  });

  it("keeps an explicit data-cwv", () => {
    expect(run(`function A() { return <div data-cwv="custom" /> }`)?.code).toBe(
      `function A() { return <div data-cwv="custom" /> }`,
    );
  });

  it("preserves directives, types and non-ASCII text", () => {
    const src = `"use client";
import { useState } from "react";
type P = { label: string };
export function Añadir({ label }: P) {
  const [n, setN] = useState<number>(0);
  return <button onClick={() => setN(n + 1)}>🛒 {label} ({n})</button>;
}`;
    const out = tagged(src);
    expect(out?.startsWith('"use client";\n')).toBe(true);
    expect(out).toContain(
      `<button data-cwv={Añadir} onClick={() => setN(n + 1)}>🛒 {label} ({n})</button>`,
    );
  });

  it("records name, file, line and content hash", () => {
    const src = `\n\nexport function A() { return <div /> }\n\nconst B = () => <p />;\n`;
    const r = run(src);
    expect(r?.components).toEqual([
      {
        id: componentId(FILE, "A"),
        name: "A",
        file: FILE,
        line: 3,
        contentHash: contentHash(src),
      },
      {
        id: componentId(FILE, "B"),
        name: "B",
        file: FILE,
        line: 5,
        contentHash: contentHash(src),
      },
    ]);
  });

  it("keeps ids when the file changes and changes the content hash", () => {
    const a = run("export function A() { return <div /> }");
    const b = run("export function A() { return <div className='x'>changed</div> }");
    expect(a?.components[0]?.id).toBe(b?.components[0]?.id);
    expect(a?.components[0]?.contentHash).not.toBe(b?.components[0]?.contentHash);
  });

  it("parses plain .js files with JSX", () => {
    expect(
      run("export default function P() { return <div /> }", "pages/x.js")?.components,
    ).toHaveLength(1);
  });

  it("returns null for files without components or that do not parse", () => {
    expect(run("export const x = 1;")).toBeNull();
    expect(run("export function A() { return <div> }")).toBeNull();
  });

  it("produces a source map", () => {
    const r = run("export function A() { return <div /> }");
    expect(r?.map.mappings.length).toBeGreaterThan(0);
    expect(r?.map.sources).toEqual([`/repo/${FILE}`]);
  });
});

describe("writeManifest", () => {
  it("merges fragments of the same build and ignores stale ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "regresso-"));
    const c = (name: string, file: string, line = 1) => ({
      id: componentId(file, name),
      name,
      file,
      line,
      contentHash: "0".repeat(16),
    });
    await writeFile(join(dir, "fragments.keep"), "");
    const meta = (buildId: string) => ({
      framework: "next",
      buildId,
      gitSha: "abc1234",
      branch: "main",
      env: "production" as const,
    });
    await writeManifest(dir, "stale", meta("old"), [c("Old", "x.tsx")]);
    await writeManifest(dir, "server", meta("b1"), [
      c("Page", "app/page.tsx"),
      c("Shared", "app/shared.tsx"),
    ]);
    const m = await writeManifest(
      dir,
      "client",
      meta("b1"),
      [c("Shared", "app/shared.tsx"), c("Button", "app/button.tsx")],
      ["/products/[slug]", "/", "/"],
    );
    expect(m.components.map((x) => x.name)).toEqual(["Button", "Page", "Shared"]);
    const onDisk = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
    expect(onDisk).toEqual({
      v: 1,
      ...meta("b1"),
      createdAt: m.createdAt,
      components: m.components,
      routes: ["/", "/products/[slug]"],
    });
    expect(validateBuildUpload(onDisk).ok).toBe(true);
  });
});

describe("makeBuildId", () => {
  it("matches the protocol's build id format", () => {
    expect(makeBuildId("0123456789abcdef0123")).toMatch(/^0123456789ab-[0-9a-z]+$/);
    expect(makeBuildId(null)).toMatch(/^nogit-/);
    expect(makeBuildId(null)).toMatch(/^[0-9A-Za-z._-]{1,64}$/);
  });
});
