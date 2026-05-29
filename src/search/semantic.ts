import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { pipeline } from "@huggingface/transformers";
import type { LoadedDoc } from "../loader.js";
import { type Chunk, buildLineSnippet, chunkDocs } from "./chunk.js";
import { type SearchEngine, type SearchHit } from "./types.js";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/**
 * Local semantic search using a small sentence-transformer model
 * (all-MiniLM-L6-v2, 384-dim embeddings) executed in-process via
 * `@huggingface/transformers`. Works fully offline after the first model
 * download (cached under `.transformers-cache`).
 *
 * Each chunk is embedded once at startup as `title + "\n\n" + text`; chunking
 * keeps each input near the model's ~256-token window so most of a chunk's
 * content survives the embedding. Queries are embedded on demand and ranked by
 * cosine similarity.
 */
export class SemanticEngine implements SearchEngine {
  readonly name = "semantic" as const;
  private extractor: FeatureExtractionPipeline | null = null;
  private chunks: readonly Chunk[] = [];
  private vectors: Float32Array[] = [];

  async init(docs: readonly LoadedDoc[]): Promise<void> {
    this.chunks = chunkDocs(docs);
    this.extractor = (await pipeline(
      "feature-extraction",
      MODEL_ID,
    )) as FeatureExtractionPipeline;

    this.vectors = [];
    for (const chunk of this.chunks) {
      this.vectors.push(await this.embed(`${chunk.title}\n\n${chunk.text}`));
    }
  }

  async query(q: string, k: number): Promise<SearchHit[]> {
    if (!this.extractor || q.trim().length === 0) return [];

    const qVec = await this.embed(q);
    const scored: Array<{ chunk: Chunk; score: number }> = [];
    for (const [i, chunk] of this.chunks.entries()) {
      const vec = this.vectors[i];
      if (!chunk || !vec) continue;
      scored.push({ chunk, score: dot(qVec, vec) });
    }

    return scored
      .toSorted((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ chunk, score }) => ({
        id: chunk.docId,
        title: chunk.title,
        score,
        snippet: buildLineSnippet(chunk, q),
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      }));
  }

  private async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) {
      throw new Error("SemanticEngine.embed called before init().");
    }
    const output = await this.extractor(text, {
      pooling: "mean",
      normalize: true,
    });
    const data = output.data as Float32Array | number[];
    return data instanceof Float32Array ? data : new Float32Array(data);
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let acc = 0;
  for (let i = 0; i < len; i++) {
    acc += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return acc;
}
