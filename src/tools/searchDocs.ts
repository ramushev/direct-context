import { z } from "zod";
import type {
  EngineName,
  EngineRegistry,
  SearchHit,
} from "../search/index.js";
import { errorResult, jsonResult } from "./util.js";

export interface SearchDocsInput {
  query: string;
  k?: number;
  engine?: EngineName;
}

export interface SearchDocsResult {
  engine: EngineName;
  query: string;
  hits: readonly SearchHit[];
}

export const makeSearchDocsTool = (
  registry: EngineRegistry,
  defaultEngine: EngineName,
) =>
  ({
    name: "search_agent_docs",
    config: {
      title: "Search agent docs",
      description:
        "Search the loaded agent docs using one of the available search engines (text, bm25, semantic). Returns ranked hits with snippets.",
      inputSchema: {
        query: z.string().min(1).describe("Free-text search query."),
        k: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Maximum number of hits to return. Defaults to 10."),
        engine: z
          .enum(["text", "bm25", "semantic"])
          .optional()
          .describe(
            "Which search engine to use. Defaults to the server's configured default.",
          ),
      },
    },
    handler: async ({ query, k, engine }: SearchDocsInput) => {
      const useEngine = engine ?? defaultEngine;
      try {
        const impl = await registry.get(useEngine);
        const hits = await impl.query(query, k ?? 10);
        return jsonResult({ engine: useEngine, query, hits } satisfies SearchDocsResult);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return errorResult(`search failed (${useEngine}): ${msg}`);
      }
    },
  }) as const;
