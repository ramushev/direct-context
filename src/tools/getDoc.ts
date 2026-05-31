import { z } from "zod";
import type { CodeRef, LoadedDocs } from "../loader.js";
import { errorResult, jsonResult } from "./util.js";

export interface GetDocInput {
  id: string;
}

export interface GetDocResult {
  id: string;
  title: string;
  kind: string;
  tags: readonly string[];
  path: string;
  /** Source files this doc cites. Pass entries straight to `read_source_file`. */
  code_refs: readonly CodeRef[];
  frontmatter: Readonly<Record<string, unknown>>;
  body: string;
}

export function buildGetDocResult(
  loaded: LoadedDocs,
  id: string,
): GetDocResult | null {
  const doc = loaded.docs.find((d) => d.id === id);
  if (!doc) return null;
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    tags: doc.tags,
    path: doc.relPath,
    code_refs: doc.codeRefs,
    frontmatter: {
      id: doc.id,
      title: doc.title,
      kind: doc.kind,
      tags: doc.tags,
      code_refs: doc.codeRefs,
      ...doc.extra,
    },
    body: doc.body,
  };
}

export const makeGetDocTool = (loaded: LoadedDocs) =>
  ({
    name: "get_agent_doc",
    config: {
      title: "Get agent doc",
      description:
        "Return a single agent doc (frontmatter + body) by its id — the middle step of the search → get → read loop. " +
        "Discover ids with `search_agent_docs` (preferred) or `list_agent_docs`. " +
        "The `code_refs` field is a typed list of `{ repo, path, ref?, description? }` pointers to source " +
        "files the doc cites — pass entries straight to `read_source_file` to inspect the underlying code.",
      inputSchema: {
        id: z.string().min(1).describe("The doc's id, e.g. 'modules/auth'."),
      },
    },
    handler: async ({ id }: GetDocInput) => {
      const result = buildGetDocResult(loaded, id);
      return result
        ? jsonResult(result)
        : errorResult(
            `No agent doc with id "${id}". Use list_agent_docs to discover available ids.`,
          );
    },
  }) as const;
