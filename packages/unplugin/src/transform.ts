import { createHash } from "node:crypto";
import type { BuildComponentV1 } from "@regresso/protocol";
import MagicString, { type SourceMap } from "magic-string";
import { parseSync } from "oxc-parser";

/** The attribute added to each component's outermost host elements. */
export const ATTR = "data-cwv";

/**
 * One component found in a source file: `id` (the `data-cwv` value, {@link componentId} of file and
 * name), `name`, repo-relative POSIX `file`, 1-based `line`, and `contentHash` of the whole file.
 * The same shape as a component in the build upload.
 */
export type ComponentRecord = BuildComponentV1;

export interface TransformResult {
  code: string;
  map: SourceMap;
  components: ComponentRecord[];
}

const ID_LENGTH = 8;
const ID_SPACE = 36n ** BigInt(ID_LENGTH);

/**
 * Stable component id: 8 base36 chars (~41 bits) of SHA-256 over the repo-relative path and the
 * component name. Depends on nothing else, so it survives rebuilds, edits and machine changes;
 * it changes only when the component is renamed or its file moves.
 */
export function componentId(file: string, name: string): string {
  const digest = createHash("sha256").update(`${file}\0${name}`).digest();
  return (digest.readBigUInt64BE(0) % ID_SPACE).toString(36).padStart(ID_LENGTH, "0");
}

/** Hash of a source file's contents: 16 hex chars of SHA-256. */
export function contentHash(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

// --- AST helpers -----------------------------------------------------------------------------
// The AST is ESTree / TS-ESTree as produced by oxc-parser. It is walked loosely typed: only a
// handful of node types matter here, and offsets (`start`/`end`) are UTF-16 indices.

// biome-ignore lint/suspicious/noExplicitAny: loosely typed AST walk, see above.
type Node = any;

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const WRAPPER_TYPES = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
]);
/** Calls whose first argument is still "the component": memo(), forwardRef(), React.memo(), … */
const HOC_NAMES = new Set(["memo", "forwardRef", "observer"]);

const isComponentName = (name: unknown): name is string =>
  typeof name === "string" && /^[A-Z]/.test(name);

function unwrap(node: Node): Node {
  while (node && WRAPPER_TYPES.has(node.type)) node = node.expression;
  return node;
}

/** Returns the function node for `fn`, `memo(fn)`, `React.forwardRef(fn)`, nested, or undefined. */
function componentFunction(node: Node): Node | undefined {
  node = unwrap(node);
  if (!node) return undefined;
  if (FUNCTION_TYPES.has(node.type)) return node;
  if (node.type === "CallExpression") {
    const callee = unwrap(node.callee);
    const name = callee?.type === "MemberExpression" ? callee.property?.name : callee?.name;
    if (HOC_NAMES.has(name)) return componentFunction(node.arguments?.[0]);
  }
  return undefined;
}

interface Candidate {
  name: string;
  fn: Node;
  start: number;
}

/** Finds module-level component declarations. */
function findCandidates(program: Node): Candidate[] {
  const out: Candidate[] = [];
  const fromDeclaration = (decl: Node, isDefault: boolean) => {
    if (!decl) return;
    if (decl.type === "FunctionDeclaration") {
      const name = decl.id?.name ?? (isDefault ? "default" : undefined);
      if (isDefault ? name : isComponentName(name)) out.push({ name, fn: decl, start: decl.start });
      return;
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        const fn = componentFunction(d.init);
        if (fn && d.id?.type === "Identifier" && isComponentName(d.id.name)) {
          out.push({ name: d.id.name, fn, start: decl.start });
        }
      }
      return;
    }
    if (isDefault) {
      // export default () => …, export default memo(function Foo() {}), …
      const fn = componentFunction(decl);
      if (fn) out.push({ name: fn.id?.name ?? "default", fn, start: decl.start });
    }
  };

  for (const stmt of program.body) {
    if (stmt.type === "ExportNamedDeclaration") fromDeclaration(stmt.declaration, false);
    else if (stmt.type === "ExportDefaultDeclaration") fromDeclaration(stmt.declaration, true);
    else fromDeclaration(stmt, false);
  }
  return out;
}

/** Collects the expressions a function returns, without entering nested functions. */
function returnedExpressions(fn: Node): Node[] {
  if (fn.body?.type !== "BlockStatement") return fn.body ? [fn.body] : [];
  const out: Node[] = [];
  const visit = (node: Node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    if (typeof node.type !== "string") return;
    if (FUNCTION_TYPES.has(node.type) || node.type === "ClassBody") return;
    if (node.type === "ReturnStatement") {
      if (node.argument) out.push(node.argument);
      return;
    }
    for (const key in node) {
      if (key !== "start" && key !== "end" && key !== "type") visit(node[key]);
    }
  };
  visit(fn.body.body);
  return out;
}

const isHostElement = (el: Node): boolean =>
  el.openingElement.name.type === "JSXIdentifier" && /^[a-z]/.test(el.openingElement.name.name);

const hasAttr = (el: Node): boolean =>
  el.openingElement.attributes.some(
    (a: Node) =>
      a.type === "JSXAttribute" && a.name?.type === "JSXIdentifier" && a.name.name === ATTR,
  );

/**
 * Finds the outermost host (lowercase) elements a component renders. Descends through fragments,
 * other components' children (`<Layout><main/></Layout>` tags `main`), conditionals and logical
 * expressions; stops at the first host element on each path. Does not enter attribute values,
 * calls or callbacks such as `.map()`.
 */
function outermostHostElements(expr: Node, out: Node[]): void {
  expr = unwrap(expr);
  if (!expr) return;
  switch (expr.type) {
    case "JSXElement":
      if (isHostElement(expr)) out.push(expr);
      else for (const c of expr.children) outermostHostElements(c, out);
      return;
    case "JSXFragment":
      for (const c of expr.children) outermostHostElements(c, out);
      return;
    case "JSXExpressionContainer":
      outermostHostElements(expr.expression, out);
      return;
    case "ConditionalExpression":
      outermostHostElements(expr.consequent, out);
      outermostHostElements(expr.alternate, out);
      return;
    case "LogicalExpression":
      if (expr.operator !== "&&") outermostHostElements(expr.left, out);
      outermostHostElements(expr.right, out);
      return;
  }
}

function lineAt(code: string, offset: number): number {
  let line = 1;
  for (let i = code.indexOf("\n"); i !== -1 && i < offset; i = code.indexOf("\n", i + 1)) line++;
  return line;
}

export interface TransformOptions {
  /** Repo-relative POSIX path of the file; the input to {@link componentId}. */
  file: string;
  /** Path used to pick the parser language from its extension, e.g. the absolute path. */
  filename?: string;
}

/**
 * Adds `data-cwv="<component id>"` to the outermost host elements of every module-level component
 * in `code`. Returns null when the file has no components (or does not parse), so callers can
 * leave it untouched.
 */
export function transformJsx(code: string, options: TransformOptions): TransformResult | null {
  if (!code.includes("<")) return null;
  const filename = options.filename ?? options.file;
  const lang = /\.tsx$/.test(filename) ? "tsx" : /\.ts$/.test(filename) ? "ts" : "jsx";
  const parsed = parseSync(filename, code, { lang, sourceType: "module" });
  if (parsed.errors.some((e) => (e.severity as string) === "Error")) return null;

  const hash = contentHash(code);
  const s = new MagicString(code);
  const components: ComponentRecord[] = [];
  const tagged = new Set<number>();

  for (const c of findCandidates(parsed.program)) {
    const elements: Node[] = [];
    for (const r of returnedExpressions(c.fn)) outermostHostElements(r, elements);
    if (!elements.length) continue; // renders no host elements of its own (or isn't a component)

    const id = componentId(options.file, c.name);
    components.push({
      id,
      name: c.name,
      file: options.file,
      line: lineAt(code, c.start),
      contentHash: hash,
    });
    for (const el of elements) {
      const at = el.openingElement.name.end;
      if (tagged.has(at) || hasAttr(el)) continue;
      tagged.add(at);
      s.appendLeft(at, ` ${ATTR}="${id}"`);
    }
  }

  if (!components.length) return null;
  return { code: s.toString(), map: s.generateMap({ hires: true, source: filename }), components };
}
