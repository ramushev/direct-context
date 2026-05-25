import path from "node:path";
import type { LoadedDoc, LoadedDocs } from "../loader.js";
import { jsonResult } from "./util.js";

export interface OutlineLeaf {
  type: "doc";
  id: string;
  title: string;
  kind: string;
  path: string;
}

export interface OutlineFolder {
  type: "folder";
  name: string;
  children: readonly OutlineNode[];
}

export type OutlineNode = OutlineFolder | OutlineLeaf;

export interface OutlineResult {
  tree: readonly OutlineNode[];
}

interface MutFolder {
  type: "folder";
  name: string;
  children: OutlineNode[];
}

function ensureFolder(parent: MutFolder, name: string): MutFolder {
  const existing = parent.children.find(
    (child): child is MutFolder => child.type === "folder" && child.name === name,
  );
  if (existing) return existing;

  const folder: MutFolder = { type: "folder", name, children: [] };
  parent.children.push(folder);
  return folder;
}

const leafFor = (doc: LoadedDoc): OutlineLeaf => ({
  type: "doc",
  id: doc.id,
  title: doc.title,
  kind: doc.kind,
  path: doc.relPath,
});

function sortChildren(folder: MutFolder): void {
  folder.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    const an = a.type === "folder" ? a.name : a.path;
    const bn = b.type === "folder" ? b.name : b.path;
    return an.localeCompare(bn);
  });
  for (const child of folder.children) {
    if (child.type === "folder") sortChildren(child as MutFolder);
  }
}

export function buildOutline(loaded: LoadedDocs): OutlineResult {
  const root: MutFolder = { type: "folder", name: "/", children: [] };

  for (const doc of loaded.docs) {
    const segments = doc.relPath.split(path.sep);
    let cursor = root;
    for (const seg of segments.slice(0, -1)) {
      if (!seg) continue;
      cursor = ensureFolder(cursor, seg);
    }
    cursor.children.push(leafFor(doc));
  }

  sortChildren(root);
  return { tree: root.children };
}

export const makeOutlineTool = (loaded: LoadedDocs) =>
  ({
    name: "outline_agent_docs",
    config: {
      title: "Outline agent docs",
      description:
        "Return a folder/file tree of every loaded agent doc, with the title and kind of each leaf.",
      inputSchema: {},
    },
    handler: async () => jsonResult(buildOutline(loaded)),
  }) as const;
