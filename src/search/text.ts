import type { LoadedDoc } from "../loader.js";
import {
  buildSnippet,
  queryTerms,
  type SearchEngine,
  type SearchHit,
} from "./types.js";

/**
 * Substring search over body + title + tags.
 *
 * Score is the number of (case-insensitive) substring occurrences across all
 * terms in the query, summed; documents that match more terms more often rank
 * higher. Title and tag matches are weighted (x3 and x2 respectively).
 */
export class TextEngine implements SearchEngine {
  readonly name = "text" as const;
  private docs: readonly LoadedDoc[] = [];

  async init(docs: readonly LoadedDoc[]): Promise<void> {
    this.docs = docs;
  }

  async query(q: string, k: number): Promise<SearchHit[]> {
    const terms = queryTerms(q);
    if (terms.length === 0) return [];

    const hits: SearchHit[] = [];
    for (const doc of this.docs) {
      const titleLower = doc.title.toLowerCase();
      const tagsLower = doc.tags.map((t) => t.toLowerCase());
      const bodyLower = doc.body.toLowerCase();

      let score = 0;
      for (const term of terms) {
        score += countOccurrences(bodyLower, term);
        if (titleLower.includes(term)) score += 3;
        for (const tag of tagsLower) {
          if (tag.includes(term)) score += 2;
        }
      }
      if (score > 0) {
        hits.push({
          id: doc.id,
          title: doc.title,
          score,
          snippet: buildSnippet(doc.body, q),
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
