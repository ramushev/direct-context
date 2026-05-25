import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { readLocalConfig } from "../src/load.js";

describe("readLocalConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "context-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when no config file is present", () => {
    expect(readLocalConfig(dir)).toBeNull();
  });

  it("parses repos from context.config.json", async () => {
    await writeFile(
      path.join(dir, "context.config.json"),
      JSON.stringify({
        repos: ["/abs/path/repo", "owner/remote@main"],
      }),
    );
    const config = readLocalConfig(dir);
    expect(config).not.toBeNull();
    expect(config?.repos).toEqual(["/abs/path/repo", "owner/remote@main"]);
  });

  it("drops empty / whitespace-only repo entries", async () => {
    await writeFile(
      path.join(dir, "context.config.json"),
      JSON.stringify({ repos: ["/abs/path", "   ", ""] }),
    );
    const config = readLocalConfig(dir);
    expect(config?.repos).toEqual(["/abs/path"]);
  });

  it("throws a clear error on invalid JSON", async () => {
    await writeFile(
      path.join(dir, "context.config.json"),
      "{ not valid json",
    );
    expect(() => readLocalConfig(dir)).toThrow(/Invalid JSON/);
  });

  it("throws when repos contains a non-string entry", async () => {
    await writeFile(
      path.join(dir, "context.config.json"),
      JSON.stringify({ repos: ["/abs/path", 42] }),
    );
    expect(() => readLocalConfig(dir)).toThrow(/must be a string/);
  });
});

describe("parseConfig source-root auto-discovery — merged top-level manifest", () => {
  let cacheDir: string;
  let sourceA: string;
  let sourceB: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), "dcx-cache-merged-"));
    sourceA = await mkdtemp(path.join(tmpdir(), "dcx-src-a-"));
    sourceB = await mkdtemp(path.join(tmpdir(), "dcx-src-b-"));
    // Top-level merged ctx.yaml with source_roots map (written by context:load).
    await writeFile(
      path.join(cacheDir, "ctx.yaml"),
      [
        "title: repo-a, repo-b",
        "generated_at: 2026-01-01T00:00:00.000Z",
        "source_roots:",
        `  repo-a: ${sourceA}`,
        `  repo-b: ${sourceB}`,
        "files: []",
      ].join("\n") + "\n",
    );
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    await rm(sourceA, { recursive: true, force: true });
    await rm(sourceB, { recursive: true, force: true });
  });

  it("auto-registers all source roots from a merged top-level index.yaml", () => {
    const config = parseConfig(["--docs", cacheDir]);
    const byName = new Map(config.sourceRoots.map((r) => [r.name, r.path]));
    expect(byName.get("repo-a")).toBe(sourceA);
    expect(byName.get("repo-b")).toBe(sourceB);
  });

  it("resolves relative source_roots paths against the docs dir", async () => {
    const relA = path.relative(cacheDir, sourceA);
    const relB = path.relative(cacheDir, sourceB);
    await writeFile(
      path.join(cacheDir, "ctx.yaml"),
      [
        "title: repo-a, repo-b",
        "source_roots:",
        `  repo-a: ${relA}`,
        `  repo-b: ${relB}`,
        "files: []",
      ].join("\n") + "\n",
    );
    const config = parseConfig(["--docs", cacheDir]);
    const byName = new Map(config.sourceRoots.map((r) => [r.name, r.path]));
    expect(byName.get("repo-a")).toBe(sourceA);
    expect(byName.get("repo-b")).toBe(sourceB);
  });

  it("skips source_roots entries whose path no longer exists", async () => {
    await rm(sourceB, { recursive: true, force: true });
    const config = parseConfig(["--docs", cacheDir]);
    expect(config.sourceRoots).toHaveLength(1);
    expect(config.sourceRoots[0]?.name).toBe("repo-a");
  });

  it("CLI --source-root is registered alongside merged manifest roots", async () => {
    const override = await mkdtemp(path.join(tmpdir(), "dcx-override-"));
    try {
      const config = parseConfig(["--docs", cacheDir, "--source-root", override]);
      expect(config.sourceRoots.some((r) => r.path === override)).toBe(true);
      expect(config.sourceRoots.some((r) => r.path === sourceA)).toBe(true);
    } finally {
      await rm(override, { recursive: true, force: true });
    }
  });
});

describe("parseConfig source-root auto-discovery — legacy per-subdir manifests", () => {
  let cacheDir: string;
  let sourceA: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), "dcx-cache-"));
    sourceA = await mkdtemp(path.join(tmpdir(), "dcx-source-"));
    // Cached repo with a manifest pointing at sourceA.
    const cachedRepo = path.join(cacheDir, path.basename(sourceA));
    await mkdir(cachedRepo, { recursive: true });
    await writeFile(
      path.join(cachedRepo, "index.yaml"),
      `title: ${path.basename(sourceA)}\nsource_root: ${sourceA}\nfiles: []\n`,
    );
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    await rm(sourceA, { recursive: true, force: true });
  });

  it("auto-registers a source root from a cached manifest's source_root", () => {
    const config = parseConfig(["--docs", cacheDir]);
    expect(config.sourceRoots).toHaveLength(1);
    expect(config.sourceRoots[0]?.name).toBe(path.basename(sourceA));
    expect(config.sourceRoots[0]?.path).toBe(sourceA);
  });

  it("skips manifest source_root entries whose path no longer exists", async () => {
    await rm(sourceA, { recursive: true, force: true });
    const config = parseConfig(["--docs", cacheDir]);
    expect(config.sourceRoots).toHaveLength(0);
  });

  it("CLI --source-root wins over manifest auto-discovery when names collide", async () => {
    // A different real path with the same basename as sourceA, via a manifest entry.
    const override = await mkdtemp(
      path.join(tmpdir(), `dcx-override-${path.basename(sourceA)}-`),
    );
    try {
      const config = parseConfig([
        "--docs",
        cacheDir,
        "--source-root",
        override,
      ]);
      const byName = new Map(config.sourceRoots.map((r) => [r.name, r.path]));
      expect(byName.get(path.basename(override))).toBe(override);
      // The auto-discovered sourceA root is still added (different basename).
      expect(byName.get(path.basename(sourceA))).toBe(sourceA);
    } finally {
      await rm(override, { recursive: true, force: true });
    }
  });
});
