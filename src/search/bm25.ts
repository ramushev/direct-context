import MiniSearch from "minisearch";
import type { LoadedDoc } from "../loader.js";
import { type Chunk, buildLineSnippet, chunkDocs, tokenizeCode } from "./chunk.js";
import { type SearchEngine, type SearchHit } from "./types.js";

interface IndexedChunk {
  id: string;
  title: string;
  tags: string;
  text: string;
}

/**
 * BM25-ish ranking via MiniSearch (term frequency + IDF + field weighting)
 * over per-chunk units. Title and tags are weighted higher than body.
 *
 * Uses a code-aware tokenizer so camelCase/snake_case identifiers are findable
 * by their parts, plus prefix and fuzzy search so partial words still match.
 */
export class Bm25Engine implements SearchEngine {
  readonly name = "bm25" as const;
  private index: MiniSearch<IndexedChunk> | null = null;
  private chunksById = new Map<string, Chunk>();

  async init(docs: readonly LoadedDoc[]): Promise<void> {
    const chunks = chunkDocs(docs);
    this.chunksById = new Map(chunks.map((c) => [c.id, c]));

    this.index = new MiniSearch<IndexedChunk>({
      idField: "id",
      fields: ["title", "tags", "text"],
      storeFields: ["id"],
      tokenize: tokenizeCode,
      searchOptions: {
        boost: { title: 3, tags: 2, text: 1 },
        prefix: true,
        fuzzy: 0.2,
        // OR (MiniSearch's default) so natural-language queries still match.
        // AND requires every term — including stopwords like "how"/"does" — to
        // co-occur in one chunk, which returns nothing for conversational
        // phrasings. IDF down-weights common terms and chunks matching more
        // query terms rank higher, so precision holds without AND.
        combineWith: "OR",
      },
    });

    this.index.addAll(
      chunks.map((c) => ({
        id: c.id,
        title: c.title,
        tags: c.tags.join(" "),
        text: c.text,
      })),
    );
  }

  async query(q: string, k: number): Promise<SearchHit[]> {
    if (!this.index || q.trim().length === 0) return [];

    const hits: SearchHit[] = [];
    for (const r of this.index.search(q).slice(0, k)) {
      const chunk = this.chunksById.get(String(r.id));
      if (!chunk) continue;
      hits.push({
        id: chunk.docId,
        title: chunk.title,
        score: r.score,
        snippet: buildLineSnippet(chunk, q),
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      });
    }
    return hits;
  }
}
