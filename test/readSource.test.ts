import { mkdtemp, mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceRoot } from "../src/config.js";
import { listDirectory, readSourceFile } from "../src/tools/readSource.js";

describe("readSourceFile", () => {
  let root: string;
  let roots: SourceRoot[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "read-source-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "hello.ts"), 'export const x = 1;\n');
    await writeFile(path.join(root, "small.txt"), "ok\n");
    await writeFile(path.join(root, "big.txt"), "x".repeat(2048));
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(
      path.join(root, ".git", "config"),
      "[remote \"origin\"]\n\turl = https://x:token@example.com/r.git\n",
    );
    roots = [{ name: path.basename(root), path: root }];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads a file under the configured root", async () => {
    const result = await readSourceFile(roots, {
      repo: roots[0]!.name,
      path: "src/hello.ts",
    });
    expect(result.content).toContain("export const x = 1");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it("reports a missing file without exposing the absolute path", async () => {
    const err = await readSourceFile(roots, {
      repo: roots[0]!.name,
      path: "src/missing.ts",
    }).catch((e: unknown) => e as Error);
    expect(err.message).toMatch(/not found in/);
    expect(err.message).not.toContain(root);
  });

  it("rejects an unknown repo", async () => {
    await expect(
      readSourceFile(roots, { repo: "nonexistent", path: "small.txt" }),
    ).rejects.toThrow(/Unknown source root/);
  });

  it("rejects paths that escape the root via ..", async () => {
    await expect(
      readSourceFile(roots, { repo: roots[0]!.name, path: "../etc/passwd" }),
    ).rejects.toThrow(/outside the configured source root/);
  });

  it("rejects symlinks that point outside the root", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "read-source-outside-"));
    try {
      await writeFile(path.join(outside, "secret.txt"), "shh");
      await symlink(
        path.join(outside, "secret.txt"),
        path.join(root, "leak.txt"),
      );
      await expect(
        readSourceFile(roots, { repo: roots[0]!.name, path: "leak.txt" }),
      ).rejects.toThrow(/outside the configured source root/);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("truncates when the file exceeds max_bytes", async () => {
    const result = await readSourceFile(roots, {
      repo: roots[0]!.name,
      path: "big.txt",
      max_bytes: 100,
    });
    expect(result.bytes).toBe(2048);
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBe(100);
  });

  it("rejects directories", async () => {
    await expect(
      readSourceFile(roots, { repo: roots[0]!.name, path: "src" }),
    ).rejects.toThrow(/not a regular file/);
  });

  it("refuses to read inside a protected dir (.git) so secrets can't leak", async () => {
    await expect(
      readSourceFile(roots, { repo: roots[0]!.name, path: ".git/config" }),
    ).rejects.toThrow(/protected directory/);
  });
});

describe("listDirectory", () => {
  let root: string;
  let roots: SourceRoot[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "list-dir-"));
    await mkdir(path.join(root, "src", "pages"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "");
    await writeFile(path.join(root, "src", "pages", "Home.tsx"), "");
    await writeFile(path.join(root, "src", "pages", "About.tsx"), "");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(root, ".git", "config"), "[core]\n");
    roots = [{ name: path.basename(root), path: root }];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists files and subdirectories, dirs first", async () => {
    const result = await listDirectory(roots, { repo: roots[0]!.name, path: "src" });
    expect(result.repo).toBe(roots[0]!.name);
    expect(result.path).toBe("src");
    const dirs = result.entries.filter((e) => e.type === "dir");
    const files = result.entries.filter((e) => e.type === "file");
    expect(dirs.map((e) => e.name)).toEqual(["pages"]);
    expect(files.map((e) => e.name)).toEqual(["index.ts"]);
    expect(dirs[0]!.type).toBe("dir");
    expect(dirs[0]!.path).toBe(path.join("src", "pages"));
    const allDirsFirst = result.entries.findIndex((e) => e.type === "file") >
      result.entries.findLastIndex((e) => e.type === "dir");
    expect(allDirsFirst).toBe(true);
  });

  it("entry paths are relative to the source root", async () => {
    const result = await listDirectory(roots, { repo: roots[0]!.name, path: "src/pages" });
    expect(result.entries.every((e) => e.path.startsWith("src/pages"))).toBe(true);
    expect(result.entries.every((e) => !e.path.includes(root))).toBe(true);
  });

  it("rejects a path that is a file, not a directory", async () => {
    await expect(
      listDirectory(roots, { repo: roots[0]!.name, path: "src/index.ts" }),
    ).rejects.toThrow(/not a directory/);
  });

  it("reports a missing directory without exposing the absolute path", async () => {
    const err = await listDirectory(roots, {
      repo: roots[0]!.name,
      path: "src/missing",
    }).catch((e: unknown) => e as Error);
    expect(err.message).toMatch(/not found in/);
    expect(err.message).not.toContain(root);
  });

  it("rejects paths that escape the root via ..", async () => {
    await expect(
      listDirectory(roots, { repo: roots[0]!.name, path: "../etc" }),
    ).rejects.toThrow(/outside the configured source root/);
  });

  it("rejects an unknown repo", async () => {
    await expect(
      listDirectory(roots, { repo: "nonexistent", path: "src" }),
    ).rejects.toThrow(/Unknown source root/);
  });

  it("refuses to list a protected dir and hides it from the root listing", async () => {
    await expect(
      listDirectory(roots, { repo: roots[0]!.name, path: ".git" }),
    ).rejects.toThrow(/protected directory/);

    const top = await listDirectory(roots, { repo: roots[0]!.name, path: "." });
    expect(top.entries.some((e) => e.name === ".git")).toBe(false);
  });
});
