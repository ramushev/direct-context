import { describe, expect, it } from "vitest";
import { loadDocs } from "../src/loader.js";
import { EngineRegistry } from "../src/search/index.js";
import { makeGetDocTool } from "../src/tools/getDoc.js";
import { makeListDocsTool } from "../src/tools/listDocs.js";
import { makeSearchDocsTool } from "../src/tools/searchDocs.js";
import { EXAMPLE_DOCS_DIR } from "./helpers.js";

describe("list_agent_docs tool", () => {
  it("returns every loaded doc", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const tool = makeListDocsTool(loaded);
    const result = await tool.handler();

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { count: number; docs: unknown[] };
    expect(sc.count).toBe(loaded.docs.length);
    expect(Array.isArray(sc.docs)).toBe(true);
  });
});

describe("get_agent_doc tool", () => {
  it("returns the doc when the id exists", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const tool = makeGetDocTool(loaded);
    const result = await tool.handler({ id: "modules/auth" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      id: string;
      title: string;
      body: string;
    };
    expect(sc.id).toBe("modules/auth");
    expect(sc.title).toBe("Authentication");
    expect(sc.body.length).toBeGreaterThan(50);
  });

  it("returns an error result when the id is unknown", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const tool = makeGetDocTool(loaded);
    const result = await tool.handler({ id: "modules/does-not-exist" });

    expect(result.isError).toBe(true);
  });

  it("surfaces code_refs as a typed array on the result", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const tool = makeGetDocTool(loaded);
    const result = await tool.handler({ id: "modules/auth" });

    const sc = result.structuredContent as {
      code_refs: Array<{ path: string; ref?: string; description?: string }>;
    };
    expect(Array.isArray(sc.code_refs)).toBe(true);
    expect(sc.code_refs.length).toBe(2);
    expect(sc.code_refs[0]?.path).toBe("src/auth/jwt.ts");
    expect(sc.code_refs[1]?.ref).toBe("requireSession");
  });
});

describe("search_agent_docs tool", () => {
  it("delegates to the requested engine and returns hits", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const registry = new EngineRegistry();
    registry.setDocs(loaded.docs);

    const tool = makeSearchDocsTool(registry, "bm25");
    const result = await tool.handler({ query: "checkout", k: 5 });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      engine: string;
      query: string;
      hits: Array<{ id: string }>;
    };
    expect(sc.engine).toBe("bm25");
    expect(sc.query).toBe("checkout");
    expect(sc.hits.length).toBeGreaterThan(0);
  });

  it("uses an explicit engine override when provided", async () => {
    const loaded = await loadDocs(EXAMPLE_DOCS_DIR);
    const registry = new EngineRegistry();
    registry.setDocs(loaded.docs);

    const tool = makeSearchDocsTool(registry, "bm25");
    const result = await tool.handler({
      query: "Stripe",
      engine: "text",
    });

    const sc = result.structuredContent as { engine: string };
    expect(sc.engine).toBe("text");
  });
});
