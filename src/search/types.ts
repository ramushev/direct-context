import type { LoadedDoc } from "../loader.js";

export interface SearchHit {
  id: string;
  title: string;
  /** Engine-defined relevance score, higher is better. */
  score: number;
  /** Short text excerpt around the matched region. */
  snippet: string;
}

export type EngineName = "text" | "bm25" | "semantic";

export interface SearchEngine {
  readonly name: EngineName;
  /** Build any in-memory state needed to answer queries. Called once at startup. */
  init(docs: readonly LoadedDoc[]): Promise<void>;
  /** Run a query and return the top-`k` hits, sorted by descending score. */
  query(q: string, k: number): Promise<SearchHit[]>;
}

/** Tokenize a free-text query into lowercased terms longer than one char. */
export const queryTerms = (q: string): string[] =>
  q
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);

/** Build a one-line snippet showing the first occurrence of any query term. */
export function buildSnippet(body: string, query: string, width = 160): string {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return body.slice(0, width).replace(/\s+/g, " ").trim();
  }

  const lower = body.toLowerCase();
  let best = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  if (best === -1) {
    return body.slice(0, width).replace(/\s+/g, " ").trim();
  }

  const start = Math.max(0, best - Math.floor(width / 4));
  const end = Math.min(body.length, start + width);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return prefix + body.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
}
