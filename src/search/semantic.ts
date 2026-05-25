import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { pipeline } from "@huggingface/transformers";
import type { LoadedDoc } from "../loader.js";
import { buildSnippet, type SearchEngine, type SearchHit } from "./types.js";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/**
 * Local semantic search using a small sentence-transformer model
 * (all-MiniLM-L6-v2, 384-dim embeddings) executed in-process via
 * `@huggingface/transformers`. Works fully offline after the first model
 * download (cached under `.transformers-cache`).
 *
 * Each document is embedded once at startup as `title + "\n\n" + body`.
 * Queries are embedded on demand and ranked by cosine similarity.
 */
export class SemanticEngine implements SearchEngine {
  readonly name = "semantic" as const;
  private extractor: FeatureExtractionPipeline | null = null;
  private docs: readonly LoadedDoc[] = [];
  private vectors: Float32Array[] = [];

  async init(docs: readonly LoadedDoc[]): Promise<void> {
    this.docs = docs;
    this.extractor = (await pipeline(
      "feature-extraction",
      MODEL_ID,
    )) as FeatureExtractionPipeline;

    this.vectors = [];
    for (const doc of docs) {
      this.vectors.push(await this.embed(`${doc.title}\n\n${doc.body}`));
    }
  }

  async query(q: string, k: number): Promise<SearchHit[]> {
    if (!this.extractor || q.trim().length === 0) return [];

    const qVec = await this.embed(q);
    const scored: Array<{ doc: LoadedDoc; score: number }> = [];
    for (const [i, doc] of this.docs.entries()) {
      const vec = this.vectors[i];
      if (!doc || !vec) continue;
      scored.push({ doc, score: dot(qVec, vec) });
    }

    return scored
      .toSorted((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ doc, score }) => ({
        id: doc.id,
        title: doc.title,
        score,
        snippet: buildSnippet(doc.body, q),
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
