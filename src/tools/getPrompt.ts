import { z } from "zod";
import type { CollectPrompt } from "../prompts/collect.js";
import { errorResult, jsonResult } from "./util.js";

export interface GetPromptResult {
  id: string;
  description: string;
  body: string;
  args: CollectPrompt["args"];
  sources: CollectPrompt["sources"];
}

export const makeGetPromptTool = (prompts: CollectPrompt[]) =>
  ({
    name: "get_prompt",
    config: {
      title: "Get collect prompt",
      description:
        "Return the full body and metadata of a documentation collect prompt by its id (e.g. '01-architecture'). " +
        "These prompts drive the doc-generation workflow (run end-to-end via 'initialize-docs') and are separate " +
        "from the search/read loop. Prompt ids follow the registered prompt names ('00-orientation', " +
        "'01-architecture', …, 'initialize-docs') and are also discoverable via the server's MCP prompts " +
        "(prompts/list). Use this to fetch the authoritative spec for a phase before executing it.",
      inputSchema: {
        id: z.string().min(1).describe("The prompt id, e.g. '01-architecture'."),
      },
    },
    handler: async ({ id }: { id: string }) => {
      const prompt = prompts.find((p) => p.name === id);
      if (!prompt) {
        const available = prompts.map((p) => p.name).join(", ");
        return errorResult(
          `No prompt with id "${id}". Available: ${available}`,
        );
      }
      const result: GetPromptResult = {
        id: prompt.name,
        description: prompt.description,
        body: prompt.body,
        args: prompt.args,
        sources: prompt.sources,
      };
      return jsonResult(result);
    },
  }) as const;
