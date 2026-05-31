import type { LoadedDoc } from "../loader.js";
import { queryTerms } from "./types.js";

/**
 * A retrievable slice of a doc. Search indexes chunks rather than whole docs so
 * that (a) embeddings stay near the model's token window, (b) hits carry a
 * precise line range, and (c) snippets show the right region. Each chunk's
 * `docId` points back at the parent `LoadedDoc`.
 */
export interface Chunk {
  /** `${docId}#L${startLine}-${endLine}` — unique across all chunks. */
  id: string;
  /** Parent doc id (what an agent passes to get_agent_doc / read_source_file). */
  docId: string;
  title: string;
  tags: readonly string[];
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  text: string;
}

// Tuned so a chunk is a meaningful unit (a function, a doc section) while
// staying small enough that the bulk of it survives a 256-token embedding.
const TARGET_LINES = 40;
const MAX_LINES = 60;
const MIN_LINES = 10;
const OVERLAP = 6;

/**
 * Lines that start a new logical unit in code. Loose on purpose — over-splitting
 * is corrected by the small-section merge in `normalizeSections`, whereas
 * missing a boundary would glue two functions into one chunk.
 */
const CODE_DEF =
  /^[\t ]*(export\s+)?(default\s+)?(public\s+|private\s+|protected\s+|static\s+|async\s+|final\s+|abstract\s+|pub\s+)*(function|class|interface|type|enum|struct|trait|impl|fn|func|def|module|namespace|const|let|var)\b/;

const MD_HEADING = /^#{1,6}\s/;

// Use markdown heading boundaries for `.md`/`.mdx` files (all served docs are
// markdown) and the code-aware boundaries for anything else.
const isMarkdown = (doc: LoadedDoc): boolean => /\.mdx?$/i.test(doc.relPath);

function findBoundaries(lines: readonly string[], markdown: boolean): number[] {
  const bounds = new Set<number>([0]);
  const re = markdown ? MD_HEADING : CODE_DEF;
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i] ?? "")) bounds.add(i);
  }
  return [...bounds].sort((a, b) => a - b);
}

/**
 * Turns raw boundary-delimited sections into final line ranges: merges
 * sections smaller than `MIN_LINES` into their successor, then splits any
 * section longer than `MAX_LINES` into overlapping `TARGET_LINES` windows.
 */
function normalizeSections(
  sections: readonly [number, number][],
): [number, number][] {
  const merged: [number, number][] = [];
  let cur: [number, number] | null = null;
  for (const [s, e] of sections) {
    if (!cur) {
      cur = [s, e];
    } else if (cur[1] - cur[0] < MIN_LINES) {
      cur[1] = e; // sections are contiguous, so extend the end
    } else {
      merged.push(cur);
      cur = [s, e];
    }
  }
  if (cur) merged.push(cur);

  const final: [number, number][] = [];
  for (const [s, e] of merged) {
    if (e - s <= MAX_LINES) {
      final.push([s, e]);
      continue;
    }
    let start = s;
    while (start < e) {
      const end = Math.min(e, start + TARGET_LINES);
      final.push([start, end]);
      if (end >= e) break;
      start = end - OVERLAP;
    }
  }
  return final;
}

function mkChunk(
  doc: LoadedDoc,
  startLine: number,
  endLine: number,
  text: string,
): Chunk {
  return {
    id: `${doc.id}#L${startLine}-${endLine}`,
    docId: doc.id,
    title: doc.title,
    tags: doc.tags,
    startLine,
    endLine,
    text,
  };
}

/** Splits a single doc into structure-aware chunks. */
export function chunkDoc(doc: LoadedDoc): Chunk[] {
  const lines = doc.body.split("\n");
  const n = lines.length;
  if (n <= TARGET_LINES) {
    return [mkChunk(doc, 1, Math.max(n, 1), doc.body)];
  }

  const bounds = findBoundaries(lines, isMarkdown(doc));
  const sections: [number, number][] = bounds.map((s, i) => [
    s,
    i + 1 < bounds.length ? (bounds[i + 1] as number) : n,
  ]);

  return normalizeSections(sections).map(([s, e]) =>
    mkChunk(doc, s + 1, e, lines.slice(s, e).join("\n")),
  );
}

/** Splits every doc into chunks, preserving doc and line order. */
export function chunkDocs(docs: readonly LoadedDoc[]): Chunk[] {
  const out: Chunk[] = [];
  for (const doc of docs) out.push(...chunkDoc(doc));
  return out;
}

/**
 * Code-aware tokenizer for the BM25 index. Splits on non-alphanumerics and on
 * camelCase/PascalCase boundaries, and keeps the original identifier too — so
 * `getUserById` is findable by `get user`, `userById`, or the whole word.
 * Lowercasing is left to MiniSearch's `processTerm`.
 */
export function tokenizeCode(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9]+/)) {
    if (!raw) continue;
    out.push(raw);
    const split = raw
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .split(/\s+/);
    if (split.length > 1) out.push(...split);
  }
  return out;
}

export interface SnippetOptions {
  /** Lines of context to show on each side of the matched line. */
  context?: number;
  /** Hard cap on the number of lines in the snippet. */
  maxLines?: number;
  /** Truncate any single line longer than this. */
  maxLineWidth?: number;
}

/**
 * Builds a multi-line, line-numbered snippet centered on the first line in the
 * chunk that matches a query term (or the chunk's start when nothing matches).
 * Line numbers are absolute (relative to the source file), so an agent can jump
 * straight to the region with `read_source_file`.
 */
export function buildLineSnippet(
  chunk: Chunk,
  query: string,
  opts: SnippetOptions = {},
): string {
  const context = opts.context ?? 2;
  const maxLines = opts.maxLines ?? 8;
  const width = opts.maxLineWidth ?? 200;

  const lines = chunk.text.split("\n");
  const terms = queryTerms(query);

  let anchor = 0;
  if (terms.length > 0) {
    for (let i = 0; i < lines.length; i++) {
      const low = (lines[i] ?? "").toLowerCase();
      if (terms.some((t) => low.includes(t))) {
        anchor = i;
        break;
      }
    }
  }

  let start = Math.max(0, anchor - context);
  const end = Math.min(lines.length, start + maxLines);
  if (end - start < maxLines) start = Math.max(0, end - maxLines);

  const out: string[] = [];
  for (let i = start; i < end; i++) {
    let text = lines[i] ?? "";
    if (text.length > width) text = `${text.slice(0, width)}…`;
    out.push(`${chunk.startLine + i}\t${text}`);
  }
  return out.join("\n");
}
