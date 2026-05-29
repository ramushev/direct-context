import { execFile as execFileCb } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRawRepoDocs } from "../src/raw.js";

const execFile = promisify(execFileCb);

describe("loadRawRepoDocs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "context-raw-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("indexes text/code files and skips binary, oversized, and lockfile entries", async () => {
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src/server.ts"), "export const port = 3050;");
    await writeFile(path.join(dir, "README.md"), "# Hello\n");
    await writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    await writeFile(path.join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(path.join(dir, "big.txt"), "x".repeat(600 * 1024));

    const docs = await loadRawRepoDocs(dir, "my-repo");
    const ids = docs.map((d) => d.id).sort();

    expect(ids).toEqual(["README.md", "src/server.ts"]);

    const server = docs.find((d) => d.id === "src/server.ts");
    expect(server).toBeDefined();
    expect(server?.kind).toBe("source");
    expect(server?.body).toContain("port = 3050");
    expect(server?.tags).toEqual(["raw", "ts"]);
    // Self code_ref lets an agent jump straight to read_source_file.
    expect(server?.codeRefs).toEqual([{ repo: "my-repo", path: "src/server.ts" }]);
  });

  it("respects .gitignore via git ls-files when the repo is a git checkout", async () => {
    await execFile("git", ["init", "-q"], { cwd: dir });
    await writeFile(path.join(dir, "keep.ts"), "export const a = 1;");
    await writeFile(path.join(dir, "secret.ts"), "export const b = 2;");
    await writeFile(path.join(dir, ".gitignore"), "secret.ts\n");
    await execFile("git", ["add", "keep.ts", ".gitignore"], { cwd: dir });

    const docs = await loadRawRepoDocs(dir, "git-repo");
    const ids = docs.map((d) => d.id).sort();

    expect(ids).toContain("keep.ts");
    expect(ids).not.toContain("secret.ts");
  });
});
