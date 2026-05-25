import MiniSearch from "minisearch";
import type { LoadedDoc } from "../loader.js";
import { buildSnippet, type SearchEngine, type SearchHit } from "./types.js";

interface IndexedDoc {
  id: string;
  title: string;
  tags: string;
  body: string;
}

/**
 * BM25-ish ranking via MiniSearch (term frequency + IDF + field weighting).
 * Title and tags are weighted higher than body.
 *
 * Configured with prefix and fuzzy search so partial words still match,
 * which is a better fit for documentation-style queries.
 */
export class Bm25Engine implements SearchEngine {
  readonly name = "bm25" as const;
  private index: MiniSearch<IndexedDoc> | null = null;
  private docsById = new Map<string, LoadedDoc>();

  async init(docs: readonly LoadedDoc[]): Promise<void> {
    this.docsById = new Map(docs.map((d) => [d.id, d]));

    this.index = new MiniSearch<IndexedDoc>({
      idField: "id",
      fields: ["title", "tags", "body"],
      storeFields: ["id", "title"],
      searchOptions: {
        boost: { title: 3, tags: 2, body: 1 },
        prefix: true,
        fuzzy: 0.2,
        combineWith: "AND",
      },
    });

    this.index.addAll(
      docs.map((d) => ({
        id: d.id,
        title: d.title,
        tags: d.tags.join(" "),
        body: d.body,
      })),
    );
  }

  async query(q: string, k: number): Promise<SearchHit[]> {
    if (!this.index || q.trim().length === 0) return [];

    const hits: SearchHit[] = [];
    for (const r of this.index.search(q).slice(0, k)) {
      const doc = this.docsById.get(String(r.id));
      if (!doc) continue;
      hits.push({
        id: doc.id,
        title: doc.title,
        score: r.score,
        snippet: buildSnippet(doc.body, q),
      });
    }
    return hits;
  }
}
