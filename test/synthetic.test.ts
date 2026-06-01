import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copyRepoToCache,
  hasTrackedAgentDocs,
  indexSourceDocs,
  loadSyntheticRepoDocs,
} from "../src/synthetic.js";

const execFile = promisify(execFileCb);

describe("loadSyntheticRepoDocs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "context-synthetic-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("synthesizes a compact (<=5) doc set from source files", async () => {
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "demo-pkg",
        version: "1.2.3",
        description: "A demo package.",
        main: "dist/index.js",
        scripts: { build: "tsc -p .", test: "vitest run" },
        dependencies: { left: "1.0.0" },
        devDependencies: { vitest: "^2" },
      }),
    );
    await writeFile(
      path.join(dir, "README.md"),
      "# Demo\n\nHello from the readme.\n\n## Usage\n\nrun it\n",
    );
    await writeFile(
      path.join(dir, "src/server.ts"),
      "export function start() {}\nexport class Server {}\n",
    );
    await writeFile(path.join(dir, "Dockerfile"), "FROM node:20\n");

    const docs = await loadSyntheticRepoDocs(dir, "demo-pkg");
    const byId = new Map(docs.map((d) => [d.id, d]));

    const overview = byId.get("overview");
    expect(overview?.kind).toBe("overview");
    expect(overview?.title).toBe("demo-pkg");
    expect(overview?.body).toContain("A demo package.");
    expect(overview?.body).toContain("1.2.3");
    expect(overview?.body).toContain("Hello from the readme.");
    expect(overview?.body).toContain("Usage"); // README heading TOC
    expect(overview?.tags).toContain("synthetic");
    expect(overview?.tags).toContain("demo-pkg"); // repo-name tag

    const arch = byId.get("architecture");
    expect(arch?.kind).toBe("architecture");
    expect(arch?.body).toContain("dist/index.js"); // entry point

    // A single consolidated modules doc — not one file per area.
    const mod = byId.get("modules");
    expect(mod?.kind).toBe("module");
    expect(mod?.body).toContain("src/server.ts");
    expect(mod?.body).toContain("`start`");
    expect(mod?.body).toContain("`Server`");
    expect(byId.has("modules/src")).toBe(false);

    // project-details emitted because there are scripts + a test runner + Docker.
    const details = byId.get("project-details");
    expect(details?.kind).toBe("project-details");
    expect(details?.body).toContain("Dockerfile");
    expect(details?.body).toContain("vitest");

    // Raw source files are not surfaced as searchable docs — only synthesized
    // structure docs are returned; source files are reached via read_source_file.
    expect(byId.has("src/server.ts")).toBe(false);

    // Synthesized docs only; never more than 5 of them.
    expect(docs[0]?.id).toBe("overview");
    expect(docs.length).toBeLessThanOrEqual(5);

    // Written into <checkout>/agent-docs/.
    expect(existsSync(path.join(dir, "agent-docs", "overview.md"))).toBe(true);
    expect(existsSync(path.join(dir, "agent-docs", "modules.md"))).toBe(true);
  });

  it("extracts exported symbols across languages (python, rust)", async () => {
    await mkdir(path.join(dir, "lib"), { recursive: true });
    await writeFile(
      path.join(dir, "lib/util.py"),
      "def helper():\n    pass\nclass Widget:\n    pass\n",
    );
    await mkdir(path.join(dir, "core"), { recursive: true });
    await writeFile(
      path.join(dir, "core/lib.rs"),
      "pub fn run() {}\npub struct Engine {}\n",
    );

    const docs = await loadSyntheticRepoDocs(dir, "multilang");
    const mod = docs.find((d) => d.id === "modules");
    expect(mod?.body).toContain("`helper`");
    expect(mod?.body).toContain("`Widget`");
    expect(mod?.body).toContain("`run`");
    expect(mod?.body).toContain("`Engine`");
  });

  it("populates overview + project-details for a Python repo (pyproject, no package.json)", async () => {
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(
      path.join(dir, "pyproject.toml"),
      [
        "[project]",
        'name = "pytool"',
        'version = "3.1.4"',
        'description = "A python tool."',
        'dependencies = ["requests", "click"]',
        "",
        "[project.optional-dependencies]",
        'test = ["pytest"]',
      ].join("\n"),
    );
    await writeFile(path.join(dir, "src/app.py"), "def main():\n    pass\n");

    const docs = await loadSyntheticRepoDocs(dir, "pytool");
    const byId = new Map(docs.map((d) => [d.id, d]));

    const overview = byId.get("overview");
    expect(overview?.title).toBe("pytool"); // name from pyproject, not repo name
    expect(overview?.body).toContain("A python tool.");
    expect(overview?.body).toContain("3.1.4");
    expect(overview?.body).toContain("requests, click"); // python runtime deps
    expect(overview?.body).toContain("`pyproject.toml` (python)"); // detected manifests

    const details = byId.get("project-details");
    expect(details?.body).toContain("pytest"); // test runner + build hint
    expect(details?.body).toContain("pip install -e .");
  });

  it("merges manifests for a polyglot repo (package.json + pyproject.toml)", async () => {
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "frontend",
        dependencies: { react: "^18" },
        scripts: { build: "vite build" },
      }),
    );
    await writeFile(
      path.join(dir, "pyproject.toml"),
      '[project]\nname = "backend"\ndependencies = ["fastapi"]\n',
    );
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src/index.ts"), "export const x = 1;");

    const docs = await loadSyntheticRepoDocs(dir, "poly");
    const overview = docs.find((d) => d.id === "overview");

    // node wins the title (higher ecosystem priority), but both manifests show.
    expect(overview?.title).toBe("frontend");
    expect(overview?.body).toContain("`package.json` (node)");
    expect(overview?.body).toContain("`pyproject.toml` (python)");
    expect(overview?.body).toContain("node — runtime:** react");
    expect(overview?.body).toContain("python — runtime:** fastapi");
  });

  it("works without a package.json (overview falls back to the repo name)", async () => {
    await mkdir(path.join(dir, "lib"), { recursive: true });
    await writeFile(path.join(dir, "lib/util.py"), "def helper():\n    pass\n");

    const docs = await loadSyntheticRepoDocs(dir, "no-pkg");
    const overview = docs.find((d) => d.id === "overview");
    expect(overview?.title).toBe("no-pkg");
    // Bare repo with no build/test/deploy signals: no project-details doc.
    expect(docs.some((d) => d.id === "project-details")).toBe(false);
  });

  it("returns nothing — and writes no docs — for a repo with no indexable files", async () => {
    await writeFile(path.join(dir, "logo.png"), Buffer.from([0x89, 0x50]));
    const docs = await loadSyntheticRepoDocs(dir, "empty");
    expect(docs).toEqual([]);
    expect(existsSync(path.join(dir, "agent-docs"))).toBe(false);
  });

  it("regenerates cleanly on re-run without re-reading its own synthesized docs", async () => {
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src/a.ts"), "export const a = 1;");

    const first = await loadSyntheticRepoDocs(dir, "r");
    expect(first.some((d) => d.id === "overview")).toBe(true);

    const second = await loadSyntheticRepoDocs(dir, "r");
    // Only synthesized docs are returned, regenerated from the source — the
    // agent-docs/ written on the first run is never picked up as input.
    expect(second.some((d) => d.id === "overview")).toBe(true);
    expect(second.some((d) => d.id.startsWith("agent-docs/"))).toBe(false);
  });
});

describe("indexSourceDocs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "context-index-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("indexes source files but never the curated agent-docs/ folder", async () => {
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src/server.ts"), "export const port = 3050;");
    await writeFile(path.join(dir, "README.md"), "# Hello\n");
    // A committed, curated docs folder (authored mode) — must stay out of the
    // source index so it isn't double-read as a source file.
    await mkdir(path.join(dir, "agent-docs"), { recursive: true });
    await writeFile(path.join(dir, "agent-docs/overview.md"), "# Overview\n");

    const files = await indexSourceDocs(dir);
    const paths = files.map((f) => f.relPath).sort();

    expect(paths).toEqual(["README.md", "src/server.ts"]);
    expect(paths.some((p) => p.startsWith("agent-docs/"))).toBe(false);
  });

  it("indexes text/code files and skips binary, oversized, and lockfile entries", async () => {
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src/server.ts"), "export const port = 3050;");
    await writeFile(path.join(dir, "README.md"), "# Hello\n");
    await writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    await writeFile(path.join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(path.join(dir, "big.txt"), "x".repeat(600 * 1024));

    const files = await indexSourceDocs(dir);
    const paths = files.map((f) => f.relPath).sort();
    expect(paths).toEqual(["README.md", "src/server.ts"]);
  });

  it("respects .gitignore via git ls-files when the checkout is a git repo", async () => {
    await execFile("git", ["init", "-q"], { cwd: dir });
    await writeFile(path.join(dir, "keep.ts"), "export const a = 1;");
    await writeFile(path.join(dir, "secret.ts"), "export const b = 2;");
    await writeFile(path.join(dir, ".gitignore"), "secret.ts\n");
    await execFile("git", ["add", "keep.ts", ".gitignore"], { cwd: dir });

    const files = await indexSourceDocs(dir);
    const paths = files.map((f) => f.relPath);
    expect(paths).toContain("keep.ts");
    expect(paths).not.toContain("secret.ts");
  });
});

describe("copyRepoToCache", () => {
  let src: string;
  let dest: string;

  beforeEach(async () => {
    src = await mkdtemp(path.join(tmpdir(), "context-copy-src-"));
    dest = await mkdtemp(path.join(tmpdir(), "context-copy-dest-"));
  });

  afterEach(async () => {
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  });

  it("snapshots tracked + unignored files, skips junk, and leaves the source untouched", async () => {
    await execFile("git", ["init", "-q"], { cwd: src });
    await writeFile(path.join(src, "keep.ts"), "export const a = 1;");
    await writeFile(path.join(src, "untracked.ts"), "export const b = 2;");
    await writeFile(path.join(src, "ignored.log"), "noise");
    await mkdir(path.join(src, "node_modules", "x"), { recursive: true });
    await writeFile(path.join(src, "node_modules", "x", "index.js"), "module.exports={}");
    await writeFile(path.join(src, ".gitignore"), "ignored.log\nnode_modules/\n");
    await execFile("git", ["add", "keep.ts", ".gitignore"], { cwd: src });

    await copyRepoToCache(src, dest);

    expect(existsSync(path.join(dest, "keep.ts"))).toBe(true); // tracked
    expect(existsSync(path.join(dest, "untracked.ts"))).toBe(true); // untracked-unignored
    expect(existsSync(path.join(dest, "ignored.log"))).toBe(false); // gitignored
    expect(existsSync(path.join(dest, "node_modules"))).toBe(false); // gitignored dir

    // Source working tree is untouched.
    expect(existsSync(path.join(src, "keep.ts"))).toBe(true);
    expect(existsSync(path.join(src, "ignored.log"))).toBe(true);
  });

  it("clears the destination before copying so no stale files linger", async () => {
    await writeFile(path.join(src, "only.ts"), "export const a = 1;");
    await mkdir(dest, { recursive: true });
    await writeFile(path.join(dest, "stale.ts"), "old");

    await copyRepoToCache(src, dest);

    expect(existsSync(path.join(dest, "stale.ts"))).toBe(false);
    expect(existsSync(path.join(dest, "only.ts"))).toBe(true);
  });
});

describe("hasTrackedAgentDocs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "context-tracked-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("is true only once agent-docs is tracked by git", async () => {
    await execFile("git", ["init", "-q"], { cwd: dir });
    await mkdir(path.join(dir, "agent-docs"), { recursive: true });
    await writeFile(path.join(dir, "agent-docs", "overview.md"), "# x\n");

    // Untracked (the synthetic-mode case) → false.
    expect(await hasTrackedAgentDocs(dir)).toBe(false);

    // Committed/authored → true.
    await execFile("git", ["add", "agent-docs/overview.md"], { cwd: dir });
    expect(await hasTrackedAgentDocs(dir)).toBe(true);
  });

  it("is false when there is no agent-docs or no git", async () => {
    expect(await hasTrackedAgentDocs(dir)).toBe(false);
  });
});
