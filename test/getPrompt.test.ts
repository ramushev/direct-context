import { describe, expect, it } from "vitest";
import { loadCollectPrompts } from "../src/prompts/collect.js";
import type { GetPromptResult } from "../src/tools/getPrompt.js";
import { makeGetPromptTool } from "../src/tools/getPrompt.js";
import { PROMPTS_DIR } from "./helpers.js";

describe("get_prompt tool", () => {
  it("returns the full body and metadata for a known prompt id", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    const tool = makeGetPromptTool(prompts);
    const result = await tool.handler({ id: "01-architecture" });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as unknown as GetPromptResult;
    expect(sc.id).toBe("01-architecture");
    expect(sc.description.length).toBeGreaterThan(0);
    expect(sc.body.length).toBeGreaterThan(50);
    expect(Array.isArray(sc.args)).toBe(true);
    expect(Array.isArray(sc.sources)).toBe(true);
  });

  it("returns an error result listing available ids when the id is unknown", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    const tool = makeGetPromptTool(prompts);
    const result = await tool.handler({ id: "does-not-exist" });

    expect(result.isError).toBe(true);
    const text = result.content[0];
    expect(text?.type).toBe("text");
    expect((text as { text: string }).text).toContain('No prompt with id "does-not-exist"');
    // The error should enumerate the real prompt ids so the caller can recover.
    expect((text as { text: string }).text).toContain("01-architecture");
  });

  it("surfaces declared args verbatim from the prompt", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    const tool = makeGetPromptTool(prompts);
    const result = await tool.handler({ id: "02-modules" });

    const sc = result.structuredContent as unknown as GetPromptResult;
    const argNames = sc.args.map((a) => a.name);
    expect(argNames).toContain("MODULE_NAME");
    expect(argNames).toContain("MODULE_PATH");
  });
});
