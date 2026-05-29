import type { LoadedDoc } from "../loader.js";
import { Bm25Engine } from "./bm25.js";
import { SemanticEngine } from "./semantic.js";
import type { SearchEngine, SearchHit } from "./types.js";

/** Standard RRF damping constant — larger flattens the contribution of rank. */
const RRF_K = 60;

const chunkKey = (h: SearchHit): string =>
  `${h.id}#${h.startLine ?? 0}-${h.endLine ?? 0}`;

/**
 * Hybrid retrieval that fuses keyword (BM25) and semantic rankings via
 * Reciprocal Rank Fusion: each chunk scores `Σ 1 / (RRF_K + rank)` across the
 * two engines. RRF needs no score normalization between the engines, which
 * matters here because BM25 and cosine scores aren't comparable.
 *
 * Note: this pulls in the semantic engine, so the first query downloads the
 * embedding model (same one-time cost as selecting `semantic` directly).
 */
export class HybridEngine implements SearchEngine {
  readonly name = "hybrid" as const;
  private readonly bm25 = new Bm25Engine();
  private readonly semantic = new SemanticEngine();

  async init(docs: readonly LoadedDoc[]): Promise<void> {
    await Promise.all([this.bm25.init(docs), this.semantic.init(docs)]);
  }

  async query(q: string, k: number): Promise<SearchHit[]> {
    if (q.trim().length === 0) return [];

    // Pull a deeper pool from each engine than we return, so fusion has room
    // to promote chunks that rank moderately in both over a one-sided top hit.
    const pool = Math.max(k * 4, 20);
    const [keyword, semantic] = await Promise.all([
      this.bm25.query(q, pool),
      this.semantic.query(q, pool),
    ]);

    const fused = new Map<string, { hit: SearchHit; score: number }>();
    const fuse = (hits: readonly SearchHit[]): void => {
      hits.forEach((hit, rank) => {
        const key = chunkKey(hit);
        const contribution = 1 / (RRF_K + rank);
        const existing = fused.get(key);
        if (existing) {
          existing.score += contribution;
        } else {
          fused.set(key, { hit, score: contribution });
        }
      });
    };
    fuse(keyword);
    fuse(semantic);

    return [...fused.values()]
      .toSorted((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ hit, score }) => ({ ...hit, score }));
  }
}
