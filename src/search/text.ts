import type { LoadedDoc } from "../loader.js";
import { type Chunk, buildLineSnippet, chunkDocs } from "./chunk.js";
import { queryTerms, type SearchEngine, type SearchHit } from "./types.js";

/**
 * Substring search over chunk text + title + tags.
 *
 * Score is the number of (case-insensitive) substring occurrences across all
 * terms in the query, summed; chunks that match more terms more often rank
 * higher. Title and tag matches are weighted (x3 and x2 respectively).
 */
export class TextEngine implements SearchEngine {
  readonly name = "text" as const;
  private chunks: readonly Chunk[] = [];

  async init(docs: readonly LoadedDoc[]): Promise<void> {
    this.chunks = chunkDocs(docs);
  }

  async query(q: string, k: number): Promise<SearchHit[]> {
    const terms = queryTerms(q);
    if (terms.length === 0) return [];

    const hits: SearchHit[] = [];
    for (const chunk of this.chunks) {
      const titleLower = chunk.title.toLowerCase();
      const tagsLower = chunk.tags.map((t) => t.toLowerCase());
      const textLower = chunk.text.toLowerCase();

      let score = 0;
      for (const term of terms) {
        score += countOccurrences(textLower, term);
        if (titleLower.includes(term)) score += 3;
        for (const tag of tagsLower) {
          if (tag.includes(term)) score += 2;
        }
      }
      if (score > 0) {
        hits.push({
          id: chunk.docId,
          title: chunk.title,
          score,
          snippet: buildLineSnippet(chunk, q),
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        });
      }
    }
    return hits.toSorted((a, b) => b.score - a.score).slice(0, k);
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}
