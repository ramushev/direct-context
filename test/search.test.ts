import { describe, expect, it } from "vitest";
import type { LoadedDoc } from "../src/loader.js";
import { loadDocs } from "../src/loader.js";
import { Bm25Engine } from "../src/search/bm25.js";
import { TextEngine } from "../src/search/text.js";
import { EXAMPLE_DOCS_DIR } from "./helpers.js";

const mkSourceDoc = (id: string, body: string): LoadedDoc => ({
  id,
  title: id,
  kind: "source",
  tags: ["synthetic", "ts"],
  sources: [],
  codeRefs: [],
  absPath: `/${id}`,
  relPath: id,
  body,
  raw: body,
  extra: {},
});

describe("text engine", () => {
  it("finds Stripe references by substring match", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const engine = new TextEngine();
    await engine.init(loaded.docs);

    const hits = await engine.query("Stripe", 5);
    expect(hits.length).toBeGreaterThan(0);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("modules/billing");
  });

  it("returns no hits for an unknown term", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const engine = new TextEngine();
    await engine.init(loaded.docs);

    const hits = await engine.query("zzzznonexistentzzz", 5);
    expect(hits).toEqual([]);
  });

  it("ranks the most-relevant doc first", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const engine = new TextEngine();
    await engine.init(loaded.docs);

    const hits = await engine.query("checkout", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBeDefined();
    const top = hits[0]?.id ?? "";
    expect(["flows/checkout", "apis/rest"]).toContain(top);
  });
});

describe("bm25 engine", () => {
  it("finds JWT-related docs via fuzzy match", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const engine = new Bm25Engine();
    await engine.init(loaded.docs);

    const hits = await engine.query("jwt session", 5);
    expect(hits.length).toBeGreaterThan(0);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("modules/auth");
  });

  it("returns the right doc for a payment query", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const engine = new Bm25Engine();
    await engine.init(loaded.docs);

    const hits = await engine.query("payment intent", 5);
    expect(hits.length).toBeGreaterThan(0);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain("modules/billing");
  });

  it("matches camelCase identifiers by their parts (code-aware tokenizer)", async () => {
    const engine = new Bm25Engine();
    await engine.init([
      mkSourceDoc("src/users.ts", "export function getUserById(id: string) {}"),
      mkSourceDoc("src/orders.ts", "export function createOrder() {}"),
    ]);

    const hits = await engine.query("get user", 5);
    expect(hits.map((h) => h.id)).toContain("src/users.ts");
  });

  it("returns chunk line ranges on each hit", async () => {
    const engine = new Bm25Engine();
    await engine.init([mkSourceDoc("src/a.ts", "const sentinelToken = 1;")]);

    const [hit] = await engine.query("sentinelToken", 5);
    expect(hit).toBeDefined();
    expect(hit?.startLine).toBe(1);
    expect(hit?.endLine).toBe(1);
    // Snippet is line-numbered.
    expect(hit?.snippet.startsWith("1\t")).toBe(true);
  });
});
