import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceRoot } from "../src/config.js";
import { searchSourceFiles } from "../src/tools/searchSource.js";

describe("searchSourceFiles", () => {
  let root: string;
  let roots: SourceRoot[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "search-source-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(
      path.join(root, "src", "hello.ts"),
      "export const greeting = 1;\nconst other = 2;\n",
    );
    await writeFile(path.join(root, "src", "notes.md"), "export const docs\n");
    await writeFile(
      path.join(root, "node_modules", "pkg", "index.ts"),
      "export const greeting = 99;\n",
    );
    roots = [{ name: path.basename(root), path: root }];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds a content match with the correct path and 1-based line", async () => {
    const result = await searchSourceFiles(roots, { query: "greeting" });
    const hit = result.matches.find((m) => m.path === "src/hello.ts");
    expect(hit).toBeDefined();
    expect(hit!.line).toBe(1);
    expect(hit!.repo).toBe(roots[0]!.name);
    expect(hit!.text).toContain("greeting");
  });

  it("is case-insensitive by default and case-sensitive on request", async () => {
    const insensitive = await searchSourceFiles(roots, { query: "GREETING" });
    expect(insensitive.matches.some((m) => m.path === "src/hello.ts")).toBe(true);

    const sensitive = await searchSourceFiles(roots, {
      query: "GREETING",
      case_sensitive: true,
    });
    expect(sensitive.matches.some((m) => m.path === "src/hello.ts")).toBe(false);
  });

  it("treats the query as a regex", async () => {
    const result = await searchSourceFiles(roots, { query: "export\\s+const" });
    expect(result.matches.some((m) => m.path === "src/hello.ts")).toBe(true);
  });

  it("applies the glob filter to restrict scanned files", async () => {
    const result = await searchSourceFiles(roots, {
      query: "export const",
      glob: "**/*.ts",
    });
    expect(result.matches.every((m) => m.path.endsWith(".ts"))).toBe(true);
    expect(result.matches.some((m) => m.path === "src/notes.md")).toBe(false);
  });

  it("ignores node_modules", async () => {
    const result = await searchSourceFiles(roots, { query: "greeting" });
    expect(result.matches.some((m) => m.path.includes("node_modules"))).toBe(
      false,
    );
  });

  it("skips binary files", async () => {
    await writeFile(
      path.join(root, "src", "blob.bin"),
      Buffer.from([0x65, 0x00, 0x67, 0x72, 0x65, 0x65, 0x74]),
    );
    const result = await searchSourceFiles(roots, { query: "greet" });
    expect(result.matches.some((m) => m.path === "src/blob.bin")).toBe(false);
  });

  it("caps results and sets truncated", async () => {
    const lines = Array.from({ length: 10 }, () => "match here").join("\n");
    await writeFile(path.join(root, "src", "many.ts"), lines);
    const result = await searchSourceFiles(roots, {
      query: "match here",
      max_results: 3,
    });
    expect(result.count).toBe(3);
    expect(result.matches.length).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("rejects an unknown repo", async () => {
    await expect(
      searchSourceFiles(roots, { query: "x", repo: "nonexistent" }),
    ).rejects.toThrow(/Unknown source root/);
  });

  it("rejects an invalid regex", async () => {
    await expect(
      searchSourceFiles(roots, { query: "(" }),
    ).rejects.toThrow(/Invalid regex/);
  });
});

describe("searchSourceFiles across multiple roots", () => {
  let rootA: string;
  let rootB: string;
  let roots: SourceRoot[];

  beforeEach(async () => {
    rootA = await mkdtemp(path.join(tmpdir(), "search-a-"));
    rootB = await mkdtemp(path.join(tmpdir(), "search-b-"));
    await writeFile(path.join(rootA, "a.ts"), "needle in a\n");
    await writeFile(path.join(rootB, "b.ts"), "needle in b\n");
    roots = [
      { name: "repoA", path: rootA },
      { name: "repoB", path: rootB },
    ];
  });

  afterEach(async () => {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  });

  it("searches all roots when repo is omitted", async () => {
    const result = await searchSourceFiles(roots, { query: "needle" });
    const repos = new Set(result.matches.map((m) => m.repo));
    expect(repos).toEqual(new Set(["repoA", "repoB"]));
    expect(result.repo).toBeNull();
  });

  it("scopes to a single root when repo is given", async () => {
    const result = await searchSourceFiles(roots, {
      query: "needle",
      repo: "repoA",
    });
    expect(result.repo).toBe("repoA");
    expect(result.matches.every((m) => m.repo === "repoA")).toBe(true);
  });
});
