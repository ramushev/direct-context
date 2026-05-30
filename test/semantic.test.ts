import { describe, expect, it } from "vitest";
import { loadDocs } from "../src/loader.js";
import { HybridEngine } from "../src/search/hybrid.js";
import { SemanticEngine } from "../src/search/semantic.js";
import { EXAMPLE_DOCS_DIR } from "./helpers.js";

// The semantic engine downloads a ~100MB model on first run; the model is
// cached afterwards. The generous per-test timeout below covers that download.
describe("semantic engine", () => {
  it(
    "ranks the auth module highest for a token-related query",
    async () => {
      const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
      const engine = new SemanticEngine();
      await engine.init(loaded.docs);

      const hits = await engine.query("how are tokens validated", 5);
      expect(hits.length).toBeGreaterThan(0);
      const ids = hits.map((h) => h.id);
      expect(ids).toContain("modules/auth");
    },
    300_000,
  );
});

describe("hybrid engine", () => {
  it(
    "fuses bm25 + semantic and surfaces the auth module for a token query",
    async () => {
      const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
      const engine = new HybridEngine();
      await engine.init(loaded.docs);

      const hits = await engine.query("how are jwt tokens validated", 5);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.map((h) => h.id)).toContain("modules/auth");
    },
    300_000,
  );
});
