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
        "Search the loaded agent docs using one of the available search engines (text, bm25, semantic, hybrid). " +
        "Results are chunk-level: each hit carries the parent doc `id` plus the `startLine`/`endLine` of the matched region " +
        "and a line-numbered snippet, so you can jump straight there with read_source_file.",
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
          .enum(["text", "bm25", "semantic", "hybrid"])
          .optional()
          .describe(
            "Which search engine to use: 'text' (substring), 'bm25' (keyword, code-aware), " +
              "'semantic' (embeddings), or 'hybrid' (RRF fusion of bm25 + semantic). " +
              "Defaults to the server's configured default. 'semantic'/'hybrid' download a model on first use.",
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
