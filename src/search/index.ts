import type { LoadedDoc } from "../loader.js";
import { Bm25Engine } from "./bm25.js";
import { HybridEngine } from "./hybrid.js";
import { SemanticEngine } from "./semantic.js";
import { TextEngine } from "./text.js";
import type { EngineName, SearchEngine } from "./types.js";

export { buildSnippet } from "./types.js";
export { buildLineSnippet, chunkDocs } from "./chunk.js";
export type { EngineName, SearchEngine, SearchHit } from "./types.js";

export function createEngine(name: EngineName): SearchEngine {
  switch (name) {
    case "text":
      return new TextEngine();
    case "bm25":
      return new Bm25Engine();
    case "semantic":
      return new SemanticEngine();
    case "hybrid":
      return new HybridEngine();
  }
}

/**
 * Lazily instantiates and initializes an engine the first time it is
 * requested. The text and BM25 engines initialize quickly; the semantic
 * engine may download a model on first use, so deferring it keeps startup
 * snappy when callers only ever use one engine.
 */
export class EngineRegistry {
  private docs: readonly LoadedDoc[] = [];
  private readonly cache = new Map<EngineName, Promise<SearchEngine>>();

  setDocs(docs: readonly LoadedDoc[]): void {
    this.docs = docs;
    this.cache.clear();
  }

  async get(name: EngineName): Promise<SearchEngine> {
    let pending = this.cache.get(name);
    if (!pending) {
      pending = (async () => {
        const engine = createEngine(name);
        await engine.init(this.docs);
        return engine;
      })();
      this.cache.set(name, pending);
    }
    return pending;
  }
}
