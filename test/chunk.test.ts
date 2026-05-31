import { describe, expect, it } from "vitest";
import type { LoadedDoc } from "../src/loader.js";
import {
  buildLineSnippet,
  chunkDoc,
  tokenizeCode,
} from "../src/search/chunk.js";

const mkDoc = (over: Partial<LoadedDoc> & { body: string }): LoadedDoc => ({
  id: "x.ts",
  title: "x.ts",
  kind: "note",
  tags: [],
  sources: [],
  codeRefs: [],
  absPath: "/x.ts",
  relPath: "x.ts",
  raw: over.body,
  extra: {},
  ...over,
});

describe("chunkDoc", () => {
  it("keeps a short doc as a single chunk covering all its lines", () => {
    const chunks = chunkDoc(mkDoc({ body: "line1\nline2\nline3" }));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[0]?.endLine).toBe(3);
    expect(chunks[0]?.id).toBe("x.ts#L1-3");
    expect(chunks[0]?.docId).toBe("x.ts");
  });

  it("splits long code on definition boundaries", () => {
    const fnA = `function alpha() {\n${"  // a\n".repeat(30)}}`;
    const fnB = `function bravo() {\n${"  // b\n".repeat(30)}}`;
    const chunks = chunkDoc(mkDoc({ body: `${fnA}\n${fnB}` }));

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk's line range is contiguous and 1-based.
    expect(chunks[0]?.startLine).toBe(1);
    for (const c of chunks) expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
    // The two functions land in different chunks.
    const alphaChunk = chunks.find((c) => c.text.includes("alpha"));
    const bravoChunk = chunks.find((c) => c.text.includes("bravo"));
    expect(alphaChunk).toBeDefined();
    expect(bravoChunk).toBeDefined();
    expect(alphaChunk?.id).not.toBe(bravoChunk?.id);
  });

  it("splits long markdown on headings", () => {
    const sec = (h: string) => `## ${h}\n${"prose line\n".repeat(25)}`;
    const doc = mkDoc({
      id: "guide.md",
      relPath: "guide.md",
      kind: "note",
      body: `# Title\n${sec("Auth")}${sec("Billing")}`,
    });
    const chunks = chunkDoc(doc);
    expect(chunks.length).toBeGreaterThan(1);
    const authChunk = chunks.find((c) => c.text.includes("## Auth"));
    const billingChunk = chunks.find((c) => c.text.includes("## Billing"));
    expect(authChunk?.id).not.toBe(billingChunk?.id);
  });
});

describe("tokenizeCode", () => {
  it("splits camelCase and keeps the whole identifier", () => {
    expect(tokenizeCode("getUserById")).toEqual([
      "getUserById",
      "get",
      "User",
      "By",
      "Id",
    ]);
  });

  it("splits on punctuation and snake_case", () => {
    expect(tokenizeCode("user_repo.findOne()")).toEqual([
      "user",
      "repo",
      "findOne",
      "find",
      "One",
    ]);
  });
});

describe("buildLineSnippet", () => {
  it("centers on the matched line and prefixes absolute line numbers", () => {
    const chunk = {
      id: "x.ts#L10-14",
      docId: "x.ts",
      title: "x.ts",
      tags: [],
      startLine: 10,
      endLine: 14,
      text: "const a = 1;\nconst b = 2;\nstartServer(3050);\nconst c = 3;\nconst d = 4;",
    };
    const snippet = buildLineSnippet(chunk, "startServer", { context: 1, maxLines: 3 });
    const lines = snippet.split("\n");
    expect(lines.some((l) => l.includes("startServer(3050)"))).toBe(true);
    // Absolute line numbering: "startServer" is the 3rd line of the chunk → line 12.
    const match = lines.find((l) => l.includes("startServer"));
    expect(match?.startsWith("12\t")).toBe(true);
  });
});
