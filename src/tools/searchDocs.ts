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
        "Primary entry point. Searches this repository's agent docs — the server's pre-built map of the codebase — " +
        "and returns the most relevant regions. Results are chunk-level: each hit carries the parent doc `id`, the " +
        "`startLine`/`endLine` of the matched region, a line-numbered snippet, and a relevance `score`. " +
        "To act on a hit, open its doc region with `get_agent_doc({ id })` to read the full doc and its `code_refs`, then " +
        "`read_source_file({ repo, path })` to open the cited source (when source roots are configured). " +
        "Every connected repo always has docs — synthetic ones are generated when none were committed — so a query always returns something. " +
        "Pick an engine with the `engine` arg (defaults to the server's configured default).",
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
