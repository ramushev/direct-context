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
        "List every agent doc loaded by the server, with id, title, kind, tags and relative path.",
      inputSchema: {},
    },
    handler: async () => jsonResult(buildListDocsResult(loaded)),
  }) as const;
