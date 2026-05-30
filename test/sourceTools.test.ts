import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceRoot } from "../src/config.js";
import {
  makeListDirectoryTool,
  makeListSourceRootsTool,
  makeReadSourceTool,
} from "../src/tools/readSource.js";
import { makeSearchSourceTool } from "../src/tools/searchSource.js";

const NO_ROOTS = /No source roots configured/;

function errorText(result: { content: { type: string }[] }): string {
  const first = result.content[0] as { type: string; text: string };
  return first.text;
}

describe("source tool factories", () => {
  let root: string;
  let roots: SourceRoot[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "source-tools-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "src", "hello.ts"),
      "export const greeting = 1;\n",
    );
    roots = [{ name: path.basename(root), path: root }];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("read_source_file", () => {
    it("returns the file contents for a valid request", async () => {
      const tool = makeReadSourceTool(roots);
      const result = await tool.handler({ repo: roots[0]!.name, path: "src/hello.ts" });

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { content: string; truncated: boolean };
      expect(sc.content).toContain("greeting");
      expect(sc.truncated).toBe(false);
    });

    it("returns an error result (not a throw) for an unknown repo", async () => {
      const tool = makeReadSourceTool(roots);
      const result = await tool.handler({ repo: "nope", path: "src/hello.ts" });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toMatch(/Unknown source root/);
    });

    it("reports when no source roots are configured", async () => {
      const tool = makeReadSourceTool([]);
      const result = await tool.handler({ repo: "any", path: "any.ts" });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toMatch(NO_ROOTS);
    });
  });

  describe("list_source_dir", () => {
    it("lists entries for a valid directory", async () => {
      const tool = makeListDirectoryTool(roots);
      const result = await tool.handler({ repo: roots[0]!.name, path: "src" });

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { entries: { name: string }[] };
      expect(sc.entries.map((e) => e.name)).toContain("hello.ts");
    });

    it("returns an error result for a missing directory", async () => {
      const tool = makeListDirectoryTool(roots);
      const result = await tool.handler({ repo: roots[0]!.name, path: "missing" });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toMatch(/not found in/);
    });

    it("reports when no source roots are configured", async () => {
      const tool = makeListDirectoryTool([]);
      const result = await tool.handler({ repo: "any", path: "src" });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toMatch(NO_ROOTS);
    });
  });

  describe("list_source_roots", () => {
    it("returns the configured roots by name", async () => {
      const tool = makeListSourceRootsTool(roots);
      const result = await tool.handler();

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as {
        count: number;
        roots: { name: string }[];
      };
      expect(sc.count).toBe(1);
      expect(sc.roots[0]!.name).toBe(roots[0]!.name);
    });

    it("returns an empty list (not an error) when nothing is configured", async () => {
      const tool = makeListSourceRootsTool([]);
      const result = await tool.handler();

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { count: number; roots: unknown[] };
      expect(sc.count).toBe(0);
      expect(sc.roots).toEqual([]);
    });
  });

  describe("search_source_files", () => {
    it("returns matches for a valid query", async () => {
      const tool = makeSearchSourceTool(roots);
      const result = await tool.handler({ query: "greeting" });

      expect(result.isError).toBeFalsy();
      const sc = result.structuredContent as { matches: { path: string }[] };
      expect(sc.matches.some((m) => m.path === "src/hello.ts")).toBe(true);
    });

    it("returns an error result for an invalid regular expression", async () => {
      const tool = makeSearchSourceTool(roots);
      const result = await tool.handler({ query: "(" });

      expect(result.isError).toBe(true);
    });

    it("reports when no source roots are configured", async () => {
      const tool = makeSearchSourceTool([]);
      const result = await tool.handler({ query: "greeting" });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toMatch(NO_ROOTS);
    });
  });
});
