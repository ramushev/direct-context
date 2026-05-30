import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

import {
  cleanUntrackedAgentDocs,
  copyRepoToCache,
  hasTrackedAgentDocs,
  loadSyntheticRepoDocs,
} from "./synthetic.js";
import { ensureRepoCached, parseGitRef, type GitRef } from "./git.js";
import { loadSingleDocs, type LoadedDoc } from "./loader.js";

const CONFIG_FILE_NAME = "context.config.json";
const AGENT_DOCS_FOLDER = "agent-docs";

type Source =
  | { kind: "local"; path: string }
  | { kind: "git"; raw: string; ref: GitRef };

const packageRoot = (): string => path.resolve(import.meta.dirname, "..");

export interface LocalConfig {
  repos?: readonly string[];
}

/**
 * Reads `context.config.json` from the package root, if it exists.
 * Returns `null` when no config file is present; throws when the file exists
 * but is malformed so the user gets a clear error instead of silently falling
 * back to the usage hint.
 */
export function readLocalConfig(packageRoot: string): LocalConfig | null {
  const configPath = path.join(packageRoot, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${CONFIG_FILE_NAME}: ${msg}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${CONFIG_FILE_NAME} must contain a JSON object.`);
  }

  const { repos } = parsed as { repos?: unknown };
  const config: LocalConfig = {};

  if (Array.isArray(repos)) {
    const cleaned: string[] = [];
    for (const r of repos) {
      if (typeof r !== "string") {
        throw new Error(
          `${CONFIG_FILE_NAME}: every entry in "repos" must be a string.`,
        );
      }
      const trimmed = r.trim();
      if (trimmed) cleaned.push(trimmed);
    }
    config.repos = cleaned;
  }
  return config;
}

function rawToSource(raw: string): Source {
  const ref = parseGitRef(raw);
  return ref ? { kind: "git", raw, ref } : { kind: "local", path: path.resolve(raw) };
}

function resolveSources(packageRoot: string): {
  sources: Source[];
  configUsed: boolean;
} {
  const config = readLocalConfig(packageRoot);
  const sources = (config?.repos ?? []).map(rawToSource);
  return { sources, configUsed: sources.length > 0 };
}

interface RepoResult {
  name: string;
  docs: readonly LoadedDoc[];
  sourceRoot?: string;
  /** How the docs were produced — drives the repos-index label. */
  mode: "synthetic" | "authored";
}

/**
 * Writes a single merged `index.yaml` at the root of `cacheDir` covering all
 * loaded repos. Each entry's `id` and `path` are prefixed with the repo name
 * (e.g. `repo-a/modules/auth`), and every `code_refs` entry gets an explicit
 * `repo` field so agents can pass refs directly to `read_source_file` without
 * extra stitching. The `source_roots` map lets the server auto-register source
 * roots on startup — no `--source-root` flag needed after a local load.
 */
async function writeMergedIndexYaml(
  dotCacheDir: string,
  repos: readonly RepoResult[],
  leadingFiles: readonly Record<string, unknown>[] = [],
): Promise<number> {
  const sourceRoots: Record<string, string> = {};
  for (const { name, sourceRoot } of repos) {
    if (sourceRoot) sourceRoots[name] = path.relative(dotCacheDir, sourceRoot);
  }

  const files: Record<string, unknown>[] = [...leadingFiles];
  for (const { name, docs } of repos) {
    for (const doc of docs) {
      const entry: Record<string, unknown> = {
        id: `${name}/${doc.id}`,
        path: path.relative(dotCacheDir, doc.absPath),
        kind: doc.kind,
      };
      if (doc.tags.length > 0) entry.tags = [...doc.tags];
      if (doc.codeRefs.length > 0) {
        entry.code_refs = doc.codeRefs.map((r) => {
          const obj: Record<string, unknown> = {
            repo: r.repo ?? name,
            path: r.path,
          };
          if (r.ref) obj.ref = r.ref;
          if (r.description) obj.description = r.description;
          return obj;
        });
      }
      files.push(entry);
    }
  }

  const manifest: Record<string, unknown> = {
    title: repos.map((r) => r.name).join(", "),
    generated_at: new Date().toISOString(),
    ...(Object.keys(sourceRoots).length > 0 ? { source_roots: sourceRoots } : {}),
    files,
  };

  writeFileSync(path.join(dotCacheDir, "ctx.yaml"), YAML.stringify(manifest));
  return files.length;
}

/**
 * Snapshots a local repo into the cache (so the working tree is never touched),
 * then serves it: committed `agent-docs/` are loaded as authored; otherwise
 * synthetic mode synthesizes a compact doc set from the source. The source root is always
 * the cache copy, so manifest paths and `code_refs` stay inside `.cache`.
 */
async function loadLocal(
  repoPath: string,
  reposCacheDir: string,
): Promise<RepoResult> {
  if (!existsSync(repoPath)) {
    process.stderr.write(
      `[ctx:load] ERROR: repo path does not exist: ${repoPath}\n`,
    );
    process.exit(1);
  }

  const repoName = path.basename(repoPath);
  const checkout = path.join(reposCacheDir, repoName);
  process.stderr.write(`[ctx:load] snapshotting local repo ${repoName} → cache\n`);
  await copyRepoToCache(repoPath, checkout);

  const docsSource = path.join(checkout, AGENT_DOCS_FOLDER);
  if (existsSync(docsSource)) {
    const { docs } = await loadSingleDocs(docsSource);
    return { name: repoName, docs, sourceRoot: checkout, mode: "authored" };
  }

  process.stderr.write(
    `[ctx:load] no ${AGENT_DOCS_FOLDER}/ in ${repoName} — synthetic mode: synthesizing structure docs from source\n`,
  );
  const docs = await loadSyntheticRepoDocs(checkout, repoName);
  return { name: repoName, docs, sourceRoot: checkout, mode: "synthetic" };
}

/**
 * Syncs a remote repo into the cache, then serves it. `agent-docs/` tracked by
 * git is treated as authored; otherwise synthetic mode generates a compact doc set
 * from the source. Untracked leftovers from a prior synthetic run are cleaned
 * before loading authored docs so they never mix in.
 */
async function loadFromGit(
  ref: GitRef,
  reposCacheDir: string,
): Promise<RepoResult> {
  const label = `${ref.owner}/${ref.repo}${ref.ref ? `@${ref.ref}` : ""}`;
  process.stderr.write(`[ctx:load] syncing ${label} …\n`);

  const repoRoot = await ensureRepoCached(ref, reposCacheDir);
  const docsSource = path.join(repoRoot, AGENT_DOCS_FOLDER);

  if (await hasTrackedAgentDocs(repoRoot)) {
    await cleanUntrackedAgentDocs(repoRoot);
    const { docs } = await loadSingleDocs(docsSource);
    return { name: ref.repo, docs, sourceRoot: repoRoot, mode: "authored" };
  }

  process.stderr.write(
    `[ctx:load] no committed ${AGENT_DOCS_FOLDER}/ in ${label} — synthetic mode: synthesizing structure docs from source\n`,
  );
  const docs = await loadSyntheticRepoDocs(repoRoot, ref.repo);
  return { name: ref.repo, docs, sourceRoot: repoRoot, mode: "synthetic" };
}

/** Unique doc kinds present in a repo's loaded docs, in stable order. */
function kindsOf(docs: readonly LoadedDoc[]): string[] {
  return [...new Set(docs.map((d) => d.kind))].sort();
}

/**
 * Builds a single cross-repo index doc listing every loaded repo — a navigation
 * entry point when many repos are configured. Written at the cache root and
 * referenced from the merged manifest with an unprefixed `repos-index` id.
 */
function buildReposIndex(repos: readonly RepoResult[]): string {
  const lines: string[] = ["# Configured repositories", ""];
  lines.push(`${repos.length} repo(s) loaded into this context server.`, "");
  lines.push("| Repo | Docs | Kinds | Mode |", "| --- | --- | --- | --- |");
  for (const r of repos) {
    const kinds = kindsOf(r.docs).join(", ") || "—";
    lines.push(`| \`${r.name}\` | ${r.docs.length} | ${kinds} | ${r.mode} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const pkgRoot = packageRoot();
  const { sources, configUsed } = resolveSources(pkgRoot);

  if (sources.length === 0) {
    process.stderr.write(
      `Usage: pnpm ctx:load\n\n  Add repos to ${CONFIG_FILE_NAME}: { "repos": ["owner/repo"] }\n`,
    );
    process.exit(1);
  }

  if (configUsed) {
    process.stderr.write(
      `[ctx:load] using ${CONFIG_FILE_NAME} (${sources.length} repo(s))\n`,
    );
  }

  const dotCacheDir = path.join(pkgRoot, ".cache");
  const reposCacheDir = path.join(dotCacheDir, "repos");

  const results: RepoResult[] = [];

  for (const source of sources) {
    const result =
      source.kind === "local"
        ? await loadLocal(source.path, reposCacheDir)
        : await loadFromGit(source.ref, reposCacheDir);

    results.push(result);
    process.stderr.write(
      `[ctx:load] ✓ ${result.name} — ${result.docs.length} doc(s)\n`,
    );
  }

  const byName = new Map<string, string>();
  for (const r of results) {
    const prior = byName.get(r.name);
    const here = r.sourceRoot ?? "(unknown)";
    if (prior && prior !== here) {
      process.stderr.write(
        `[ctx:load] ERROR: two repos resolve to the same name "${r.name}":\n` +
          `  - ${prior}\n` +
          `  - ${here}\n` +
          `Rename one of the local checkouts, or list only one of these repos in ${CONFIG_FILE_NAME}.\n`,
      );
      process.exit(1);
    }
    byName.set(r.name, here);
  }

  // Cross-repo navigation doc, written at the cache root and listed first.
  writeFileSync(path.join(dotCacheDir, "repos-index.md"), buildReposIndex(results));
  const indexEntry: Record<string, unknown> = {
    id: "repos-index",
    path: "repos-index.md",
    kind: "overview",
    tags: ["synthetic", "index"],
  };

  const totalDocs = await writeMergedIndexYaml(dotCacheDir, results, [indexEntry]);

  process.stderr.write(
    `[ctx:load] loaded ${results.length} repo(s), ${totalDocs} total doc(s) into ${path.join(dotCacheDir, "ctx.yaml")}\n`,
  );
}

// Only run when this module is executed directly (i.e. via `pnpm ctx:load`),
// not when something — like a test — imports `readLocalConfig` from it.
const invokedAsScript = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return import.meta.filename === path.resolve(argv1);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[ctx:load] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
