import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDocs } from "../src/loader.js";
import { EXAMPLE_DOCS_DIR } from "./helpers.js";

describe("loader on the example docs", () => {
  it("loads the manifest and every file it references", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);

    expect(loaded.manifest).not.toBeNull();
    expect(loaded.manifest?.title).toBe("shopcart");
    expect(loaded.docs.length).toBeGreaterThanOrEqual(7);

    const ids = loaded.docs.map((d) => d.id);
    expect(ids).toContain("overview");
    expect(ids).toContain("architecture");
    expect(ids).toContain("modules/auth");
    expect(ids).toContain("modules/billing");
    expect(ids).toContain("flows/checkout");
    expect(ids).toContain("apis/rest");
    expect(ids).toContain("glossary");
  });

  it("parses frontmatter and detaches it from the body", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const auth = loaded.docs.find((d) => d.id === "modules/auth");
    expect(auth).toBeDefined();
    if (!auth) return;

    expect(auth.title).toBe("Authentication");
    expect(auth.kind).toBe("module");
    expect(auth.tags).toContain("auth");
    expect(auth.body.startsWith("---")).toBe(false);
    expect(auth.body).toContain("Authentication");
    expect(auth.extra).toHaveProperty("source");
  });

  it("orders docs starting with the manifest order", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    expect(loaded.docs[0]?.id).toBe("overview");
    expect(loaded.docs[1]?.id).toBe("architecture");
  });

  it("parses code_refs from frontmatter — accepting both string and object entries", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const auth = loaded.docs.find((d) => d.id === "modules/auth");
    expect(auth).toBeDefined();
    if (!auth) return;

    expect(auth.codeRefs.length).toBe(2);
    expect(auth.codeRefs[0]).toEqual({ path: "src/auth/jwt.ts" });
    expect(auth.codeRefs[1]).toEqual({
      path: "src/auth/middleware.ts",
      ref: "requireSession",
      description: "Express middleware that loads the session for every request.",
    });

    // code_refs is promoted to a first-class field — should NOT also live in `extra`.
    expect(auth.extra).not.toHaveProperty("code_refs");
  });
});

describe("loadDocs (multi-repo mode)", () => {
  let parent: string;

  beforeEach(async () => {
    parent = await mkdtemp(path.join(tmpdir(), "loader-multirepo-"));
  });

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  it("defaults code_refs[].repo to the repo-name prefix when the doc omits one", async () => {
    const repoDir = path.join(parent, "repo-a");
    await mkdir(repoDir, { recursive: true });
    await writeFile(
      path.join(repoDir, "index.yaml"),
      [
        "title: repo-a",
        "files:",
        "  - id: modules/foo",
        "    path: modules/foo.md",
        "    kind: module",
      ].join("\n"),
    );
    await mkdir(path.join(repoDir, "modules"), { recursive: true });
    await writeFile(
      path.join(repoDir, "modules", "foo.md"),
      [
        "---",
        "code_refs:",
        "  - src/foo.ts",                   // no repo — should inherit "repo-a"
        "  - repo: shared",                  // explicit repo — should be preserved
        "    path: lib/util.ts",
        "---",
        "# Foo",
      ].join("\n"),
    );

    // Second repo so loadDocs picks the multi-repo branch.
    const repoDirB = path.join(parent, "repo-b");
    await mkdir(repoDirB, { recursive: true });
    await writeFile(
      path.join(repoDirB, "index.yaml"),
      "title: repo-b\nfiles: []\n",
    );

    const loaded = await loadDocs(parent);
    const foo = loaded.docs.find((d) => d.id === "repo-a/modules/foo");
    expect(foo).toBeDefined();
    if (!foo) return;
    expect(foo.codeRefs[0]).toEqual({ repo: "repo-a", path: "src/foo.ts" });
    expect(foo.codeRefs[1]).toEqual({ repo: "shared", path: "lib/util.ts" });
  });
});
