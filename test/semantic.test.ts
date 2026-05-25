import { describe, expect, it } from "vitest";
import { loadDocs } from "../src/loader.js";
import { SemanticBackend } from "../src/search/semantic.js";
import { EXAMPLE_DOCS_DIR } from "./helpers.js";

// The semantic engine downloads a ~100MB model on first run, so it is
// gated behind an env var. Set CONTEXT_RUN_SEMANTIC_TESTS=1 to enable.
const enabled = process.env.CONTEXT_RUN_SEMANTIC_TESTS === "1";
const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe("semantic engine", () => {
  it(
    "ranks the auth module highest for a token-related query",
    async () => {
      const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
      const engine = new SemanticBackend();
      await engine.init(loaded.docs);

      const hits = await engine.query("how are tokens validated", 5);
      expect(hits.length).toBeGreaterThan(0);
      const ids = hits.map((h) => h.id);
      expect(ids).toContain("modules/auth");
    },
    300_000,
  );
});
