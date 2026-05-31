import type { LoadedDocs } from "../loader.js";
import { jsonResult } from "./util.js";

export interface DocSummary {
  id: string;
  title: string;
  kind: string;
  tags: readonly string[];
  path: string;
}

export interface ListDocsResult {
  count: number;
  docs: readonly DocSummary[];
}

export function buildListDocsResult(loaded: LoadedDocs): ListDocsResult {
  const summaries: DocSummary[] = loaded.docs.map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.kind,
    tags: d.tags,
    path: d.relPath,
  }));
  return { count: summaries.length, docs: summaries };
}

export const makeListDocsTool = (loaded: LoadedDocs) =>
  ({
    name: "list_agent_docs",
    config: {
      title: "List agent docs",
      description:
        "Browse the full catalog of agent docs describing this repository — id, title, kind, tags and relative path " +
        "for every loaded doc (takes no arguments). These docs are the server's map of the codebase, and every " +
        "connected repo always has them (synthetic docs are generated when none were committed). For a targeted " +
        "lookup prefer `search_agent_docs`. Intended loop: `search_agent_docs` / `list_agent_docs` → " +
        "`get_agent_doc` (returns `code_refs`) → `read_source_file` (when source roots are configured).",
      inputSchema: {},
    },
    handler: async () => jsonResult(buildListDocsResult(loaded)),
  }) as const;
