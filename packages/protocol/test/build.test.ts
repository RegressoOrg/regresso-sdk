import { describe, expect, it } from "vitest";
import {
  type BuildUploadV1,
  isBuildUpload,
  MAX_BUILD_ROUTES,
  validateBuildUpload,
} from "../src/index.js";

const upload: BuildUploadV1 = {
  v: 1,
  framework: "next",
  buildId: "a03fc282419b-mw19kh7c39cb",
  gitSha: "a03fc282419bfd1453dfccc9d2f4e20a77d8e543",
  branch: "feature/checkout-v2",
  env: "preview",
  createdAt: "2026-11-04T12:00:00.000Z",
  components: [
    {
      id: "grnw4oy7",
      name: "AddToCart",
      file: "components/add-to-cart.tsx",
      line: 6,
      contentHash: "25d14e0d8eb550a3",
    },
  ],
  routes: ["/", "/products/[slug]", "/blog/[...slug]", "/docs/[[...path]]"],
};

const issues = (x: unknown) => {
  const r = validateBuildUpload(x);
  return r.ok ? [] : r.issues.map((i) => i.path);
};

describe("validateBuildUpload", () => {
  it("accepts a full upload and returns an equal fresh object", () => {
    const r = validateBuildUpload(upload);
    expect(r).toEqual({ ok: true, value: upload });
    if (r.ok) expect(r.value).not.toBe(upload);
    expect(isBuildUpload(upload)).toBe(true);
  });

  it("accepts null git metadata and empty lists", () => {
    const r = validateBuildUpload({
      ...upload,
      gitSha: null,
      branch: null,
      components: [],
      routes: [],
    });
    expect(r.ok).toBe(true);
  });

  it("drops unknown fields at every level", () => {
    const r = validateBuildUpload({
      ...upload,
      extra: 1,
      components: [{ ...upload.components[0], secret: "x" }],
    });
    expect(r.ok && Object.keys(r.value)).not.toContain("extra");
    expect(r.ok && Object.keys(r.value.components[0] ?? {})).not.toContain("secret");
  });

  it("rejects other versions", () => {
    expect(validateBuildUpload({ ...upload, v: 2 })).toEqual({
      ok: false,
      issues: [{ path: "v", message: "unsupported version" }],
    });
    expect(validateBuildUpload("nope").ok).toBe(false);
  });

  it("requires gitSha and branch to be present, as null when unknown", () => {
    const { gitSha: _a, branch: _b, ...rest } = upload;
    expect(issues(rest)).toEqual(["gitSha", "branch"]);
  });

  it.each([
    ["framework", "Next.js"],
    ["buildId", "has space"],
    ["gitSha", "XYZ"],
    ["branch", "two words"],
    ["env", "staging"],
    ["createdAt", "yesterday"],
  ])("rejects a bad %s", (key, value) => {
    expect(issues({ ...upload, [key]: value })).toEqual([key]);
  });

  it.each([
    ["id", "TOO-LONG-AND-UPPER"],
    ["name", "has space"],
    ["file", "/abs/path.tsx"],
    ["file", "../outside.tsx"],
    ["line", 0],
    ["contentHash", "abc"],
  ])("rejects a component with a bad %s", (key, value) => {
    const c = { ...upload.components[0], [key]: value };
    expect(issues({ ...upload, components: [c] })).toEqual([`components.0.${key}`]);
  });

  it.each(["products", "/a?b=1", "/a#x", "/(shop)/cart", "/a b"])("rejects route %p", (t) => {
    expect(issues({ ...upload, routes: [t] })).toEqual(["routes.0"]);
  });

  it("bounds the number of routes", () => {
    const routes = Array.from({ length: MAX_BUILD_ROUTES + 1 }, (_, i) => `/r${i}`);
    expect(issues({ ...upload, routes })).toEqual(["routes"]);
  });
});
