import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import YAML from "yaml";

export const DOC_KINDS = [
  "overview",
  "architecture",
  "module",
  "flow",
  "api",
  "glossary",
  "note",
  "project-details",
  "business-logic",
  "data-model",
  "permissions",
  "integrations",
  "configuration",
  "jobs",
  "events",
  "errors",
  "observability",
  "deployment",
  "ownership",
  "frontend",
  "compliance",
  "testing",
  "patterns",
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(DOC_KINDS);

export const SOURCE_RELATIONS = [
  "prerequisite",
  "drilldown",
  "companion",
  "see-also",
] as const;
export type SourceRelation = (typeof SOURCE_RELATIONS)[number];

const RELATION_SET: ReadonlySet<string> = new Set(SOURCE_RELATIONS);

export interface SourceRef {
  id: string;
  description: string;
  /** Semantic relationship from this doc to the referenced one. */
  relation?: SourceRelation;
  /** Where the referenced doc lives, relative to `agent-docs/`. */
  path?: string;
}

/**
 * Pointer from a doc to a source file the doc cites.
 *
 * The bridge between `search_agent_docs`/`get_agent_doc` and
 * `read_source_file`: an agent can pull a doc, inspect `code_refs`, then
 * pass `{ repo, path }` straight to `read_source_file`.
 */
export interface CodeRef {
  /**
   * Source-root name (matches `--source-root` basename). Inferred from the
   * repo prefix in multi-repo mode when omitted in the doc's frontmatter.
   */
  repo?: string;
  /** Path relative to the source root, e.g. `src/server.ts`. */
  path: string;
  /** Optional symbol or anchor within the file. */
  ref?: string;
  /** Optional human-readable description of what's at this location. */
  description?: string;
}

export interface LoadedDoc {
  /** Stable id, e.g. "modules/auth". Falls back to the relative path when missing. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Kind of document. */
  kind: DocKind;
  /** Free-form tags. */
  tags: readonly string[];
  /** Related doc IDs to consult for more detail. */
  sources: readonly SourceRef[];
  /** Source-code files this doc cites — pass entries to `read_source_file`. */
  codeRefs: readonly CodeRef[];
  /** Absolute path to the source file. */
  absPath: string;
  /** Path relative to the docs root. */
  relPath: string;
  /** Markdown body without frontmatter. */
  body: string;
  /** Full original file content (frontmatter + body). */
  raw: string;
  /** Any extra frontmatter fields. */
  extra: Readonly<Record<string, unknown>>;
}

export interface ManifestEntry {
  id: string;
  path: string;
  kind: DocKind;
  title?: string;
  tags?: readonly string[];
  sources?: readonly SourceRef[];
  codeRefs?: readonly CodeRef[];
}

export interface Manifest {
  title: string;
  version?: string;
  generated_at?: string;
  tags?: readonly string[];
  /**
   * Absolute path to the local source-code root these docs were collected
   * from. Written by `context:load` for single-repo manifests.
   */
  source_root?: string;
  /**
   * Per-repo source roots written by `context:load` into the merged top-level
   * index.yaml. Keys are repo names; values are absolute paths on disk.
   */
  source_roots?: Readonly<Record<string, string>>;
  files: readonly ManifestEntry[];
}

export interface LoadedDocs {
  /** Absolute path to the docs root. */
  root: string;
  /** Parsed manifest if present. */
  manifest: Manifest | null;
  /** All loaded documents, in manifest order followed by any extras discovered on disk. */
  docs: readonly LoadedDoc[];
}

const isDocKind = (value: unknown): value is DocKind =>
  typeof value === "string" && KIND_SET.has(value);

const isSourceRelation = (value: unknown): value is SourceRelation =>
  typeof value === "string" && RELATION_SET.has(value);

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

function asSourceRefArray(value: unknown): readonly SourceRef[] {
  if (!Array.isArray(value)) return [];
  const result: SourceRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const d = item as Record<string, unknown>;
    if (typeof d.id !== "string") continue;
    const entry: SourceRef = {
      id: d.id,
      description: typeof d.description === "string" ? d.description : "",
    };
    if (isSourceRelation(d.relation)) entry.relation = d.relation;
    if (typeof d.path === "string" && d.path.length > 0) entry.path = d.path;
    result.push(entry);
  }
  return result;
}

/**
 * Parses the `code_refs:` frontmatter block.
 *
 * Accepts two shapes per entry:
 *   - A bare string: treated as `{ path: <string> }`.
 *   - An object: `{ path, repo?, ref?, description? }`. Entries with no `path`
 *     are dropped.
 *
 * Returns an empty array for unrecognized inputs rather than throwing — the
 * loader should never reject a doc just because its refs are malformed.
 */
function asCodeRefArray(value: unknown): readonly CodeRef[] {
  if (!Array.isArray(value)) return [];
  const result: CodeRef[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) result.push({ path: trimmed });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const d = item as Record<string, unknown>;
    if (typeof d.path !== "string" || d.path.length === 0) continue;
    const entry: CodeRef = { path: d.path };
    if (typeof d.repo === "string" && d.repo.length > 0) entry.repo = d.repo;
    if (typeof d.ref === "string" && d.ref.length > 0) entry.ref = d.ref;
    if (typeof d.description === "string" && d.description.length > 0) {
      entry.description = d.description;
    }
    result.push(entry);
  }
  return result;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

async function readManifest(root: string): Promise<Manifest | null> {
  for (const name of ["index.yaml", "index.yml", "ctx.yaml"]) {
    const p = path.join(root, name);
    if (!(await fileExists(p))) continue;

    const text = await readFile(p, "utf8");
    const parsed = YAML.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Manifest ${p} is empty or not an object.`);
    }
    const obj = parsed as Record<string, unknown>;

    const filesRaw = Array.isArray(obj.files) ? obj.files : [];
    const files: ManifestEntry[] = [];
    for (const entry of filesRaw) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.id !== "string" || typeof e.path !== "string") continue;
      if (!isDocKind(e.kind)) continue;
      files.push({
        id: e.id,
        path: e.path,
        kind: e.kind,
        title: typeof e.title === "string" ? e.title : undefined,
        tags: asStringArray(e.tags),
        sources: asSourceRefArray(e.sources),
        codeRefs: asCodeRefArray(e.code_refs),
      });
    }

    const sourceRootsRaw = obj.source_roots;
    let source_roots: Record<string, string> | undefined;
    if (
      sourceRootsRaw &&
      typeof sourceRootsRaw === "object" &&
      !Array.isArray(sourceRootsRaw)
    ) {
      source_roots = {};
      for (const [k, v] of Object.entries(
        sourceRootsRaw as Record<string, unknown>,
      )) {
        if (typeof v === "string" && v.length > 0) source_roots[k] = v;
      }
    }

    return {
      title: typeof obj.title === "string" ? obj.title : "untitled",
      version: typeof obj.version === "string" ? obj.version : undefined,
      generated_at:
        typeof obj.generated_at === "string" ? obj.generated_at : undefined,
      tags: asStringArray(obj.tags),
      source_root:
        typeof obj.source_root === "string" && obj.source_root.length > 0
          ? obj.source_root
          : undefined,
      source_roots,
      files,
    };
  }
  return null;
}

async function walkMarkdown(root: string): Promise<string[]> {
  const results: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        results.push(full);
      }
    }
  };
  await walk(root);
  return results.toSorted();
}

function inferTitleFromBody(body: string, fallback: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return fallback;
}

function inferKindFromPath(rel: string): DocKind {
  const [top] = rel.split(path.sep);
  switch (top) {
    case "modules":
      return "module";
    case "flows":
      return "flow";
    case "apis":
      return "api";
    default:
      break;
  }
  const base = path.basename(rel, path.extname(rel)).toLowerCase();
  if (base === "runtime-behavior") return "configuration";
  if (isDocKind(base)) return base;
  return "note";
}

interface LoadDocHint {
  id?: string;
  kind?: DocKind;
  tags?: readonly string[];
  title?: string;
  sources?: readonly SourceRef[];
  codeRefs?: readonly CodeRef[];
}

const RESERVED_FRONTMATTER_KEYS = new Set([
  "id",
  "title",
  "kind",
  "tags",
  "sources",
  "code_refs",
]);

async function loadDocFromPath(
  root: string,
  absPath: string,
  hint: LoadDocHint,
): Promise<LoadedDoc> {
  const raw = await readFile(absPath, "utf8");
  const parsed = matter(raw);
  const data = (parsed.data ?? {}) as Record<string, unknown>;
  const relPath = path.relative(root, absPath);

  const id =
    hint.id ??
    (typeof data.id === "string" ? data.id : undefined) ??
    relPath.replace(/\.md$/i, "");

  const kind: DocKind =
    hint.kind ?? (isDocKind(data.kind) ? data.kind : inferKindFromPath(relPath));

  const tags = Array.from(
    new Set([...(hint.tags ?? []), ...asStringArray(data.tags)]),
  );

  const title =
    hint.title ??
    (typeof data.title === "string" ? data.title : undefined) ??
    inferTitleFromBody(parsed.content, id);

  const sources = hint.sources ?? asSourceRefArray(data.sources);
  const codeRefs =
    hint.codeRefs && hint.codeRefs.length > 0
      ? hint.codeRefs
      : asCodeRefArray(data.code_refs);

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!RESERVED_FRONTMATTER_KEYS.has(k)) extra[k] = v;
  }

  return {
    id,
    title,
    kind,
    tags,
    sources,
    codeRefs,
    absPath,
    relPath,
    body: parsed.content,
    raw,
    extra,
  };
}

async function tryLoadDoc(
  root: string,
  absPath: string,
  hint: LoadDocHint,
): Promise<LoadedDoc | null> {
  try {
    return await loadDocFromPath(root, absPath, hint);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[loader] WARN: skipping ${path.relative(root, absPath)} — ${msg}\n`,
    );
    return null;
  }
}

/**
 * Loads a single docs collection rooted at `root`.
 *
 * When a manifest (index.yaml / ctx.yaml) is present it is treated as
 * authoritative — only the files it lists are loaded. When no manifest exists
 * the directory is walked for any `.md` files.
 */
export async function loadSingleDocs(root: string): Promise<LoadedDocs> {
  const manifest = await readManifest(root);
  const docs: LoadedDoc[] = [];

  if (manifest) {
    for (const entry of manifest.files) {
      const abs = path.resolve(root, entry.path);
      if (!(await fileExists(abs))) {
        throw new Error(
          `Manifest references missing file: ${entry.path} (resolved to ${abs}).`,
        );
      }
      const doc = await tryLoadDoc(root, abs, {
        id: entry.id,
        kind: entry.kind,
        tags: entry.tags,
        title: entry.title,
        sources: entry.sources,
        codeRefs: entry.codeRefs,
      });
      if (doc) docs.push(doc);
    }
  } else {
    for (const abs of await walkMarkdown(root)) {
      const doc = await tryLoadDoc(root, abs, {});
      if (doc) docs.push(doc);
    }
  }

  return { root, manifest, docs };
}

/**
 * Prefixes every doc's `id` and `relPath` with `repoName/` so that docs from
 * multiple repositories can coexist without ID collisions.
 *
 * Also defaults each `code_refs[].repo` to `repoName` when the doc did not
 * explicitly declare one — that way an agent can pass a code_ref straight to
 * `read_source_file` without first stitching together the source-root name
 * from the doc id.
 */
const prefixDocs = (
  docs: readonly LoadedDoc[],
  repoName: string,
): LoadedDoc[] =>
  docs.map((doc) => ({
    ...doc,
    id: `${repoName}/${doc.id}`,
    relPath: `${repoName}/${doc.relPath}`,
    codeRefs: doc.codeRefs.map((ref) =>
      ref.repo ? ref : { ...ref, repo: repoName },
    ),
  }));

const AGENT_DOCS_FOLDER = "agent-docs";

/**
 * Loads agent docs from a repository path by resolving the
 * `<repoPath>/agent-docs/` directory. Useful for validating that a repo
 * has agent docs before copying them.
 */
export async function loadRepoDocs(repoPath: string): Promise<LoadedDocs> {
  const docsDir = path.join(repoPath, AGENT_DOCS_FOLDER);
  try {
    const s = await stat(docsDir);
    if (!s.isDirectory()) {
      throw new Error(`${docsDir} exists but is not a directory.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No ${AGENT_DOCS_FOLDER}/ found in ${repoPath}. ` +
          `Run the collect prompts against this repo first.`,
      );
    }
    throw err;
  }
  return loadSingleDocs(docsDir);
}

/**
 * Loads and merges agent docs from multiple repository paths.
 * Each repo's docs are prefixed with the repo directory name.
 */
export async function loadMultiRepoDocs(
  repoPaths: readonly string[],
): Promise<LoadedDocs> {
  if (repoPaths.length === 0) {
    throw new Error("No repository paths provided.");
  }
  const [first] = repoPaths;
  if (!first) throw new Error("No repository paths provided.");
  if (repoPaths.length === 1) return loadRepoDocs(first);

  const allDocs: LoadedDoc[] = [];
  for (const repoPath of repoPaths) {
    const repoName = path.basename(repoPath);
    const loaded = await loadRepoDocs(repoPath);
    allDocs.push(...prefixDocs(loaded.docs, repoName));
  }
  return { root: path.dirname(first), manifest: null, docs: allDocs };
}

/**
 * Loads docs from `root`.
 *
 * **Single-repo mode** (default / backward-compatible): if `root` itself has
 * an `index.yaml` manifest, or has no subdirectories with their own manifests,
 * it is loaded as a single collection exactly as before.
 *
 * **Multi-repo mode**: if `root` contains subdirectories that each have their
 * own `index.yaml`, every such subdirectory is loaded as an independent docs
 * collection and the results are merged. Each doc's `id` and `relPath` are
 * prefixed with the subdirectory name (e.g. `example/modules/auth`) to prevent
 * collisions across repositories.
 */
export async function loadDocs(root: string): Promise<LoadedDocs> {
  if (await readManifest(root)) return loadSingleDocs(root);

  const entries = await readdir(root, { withFileTypes: true });
  const subRepoDirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const sub = path.join(root, entry.name);
    if (await readManifest(sub)) subRepoDirs.push(sub);
  }

  if (subRepoDirs.length === 0) return loadSingleDocs(root);

  const allDocs: LoadedDoc[] = [];
  for (const sub of subRepoDirs.toSorted()) {
    const repoName = path.basename(sub);
    const subDocs = await loadSingleDocs(sub);
    allDocs.push(...prefixDocs(subDocs.docs, repoName));
  }
  return { root, manifest: null, docs: allDocs };
}
