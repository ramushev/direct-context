import { execFile as execFileCb } from "node:child_process";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { CodeRef, LoadedDoc } from "./loader.js";

const execFile = promisify(execFileCb);

/**
 * Synthetic mode = the no-AI fallback for repos without a committed `agent-docs/`.
 *
 * It does two things, neither of which needs an LLM:
 *   1. Reads the repo's source files into memory to drive synthesis. The raw
 *      files are *not* surfaced as searchable docs — agents reach them through
 *      `read_source_file`, following `code_refs` from the synthesized docs.
 *   2. Synthesizes a compact, high-signal set of structure docs — `overview`,
 *      `architecture`, a single consolidated `modules` map, and (when there are
 *      signals for it) `project-details` — written into the checkout's
 *      `agent-docs/` folder, exactly where authored/AI docs would live.
 */

// ---------------------------------------------------------------------------
// Source-file selection
// ---------------------------------------------------------------------------

/** Files larger than this are skipped — they bloat the index and are rarely useful prose. */
const RAW_MAX_FILE_BYTES = 512 * 1024;

/**
 * Text/code extensions worth indexing. Anything not listed here (images,
 * fonts, archives, compiled artifacts, …) is skipped so the search index
 * stays free of binary noise.
 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".txt",
  ".rst",
  ".adoc",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".groovy",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".hh",
  ".cxx",
  ".cs",
  ".php",
  ".swift",
  ".scala",
  ".clj",
  ".cljs",
  ".ex",
  ".exs",
  ".erl",
  ".hs",
  ".lua",
  ".dart",
  ".m",
  ".mm",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".prisma",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".properties",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".vue",
  ".svelte",
  ".xml",
  ".gradle",
  ".tf",
  ".tfvars",
  ".r",
]);

/** Extensionless filenames that are still worth indexing. */
const KNOWN_TEXT_FILES: ReadonlySet<string> = new Set([
  "Dockerfile",
  "Makefile",
  "Rakefile",
  "Gemfile",
  "Procfile",
  "Brewfile",
  "README",
  "LICENSE",
  "CHANGELOG",
  "AUTHORS",
  "NOTICE",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
  ".eslintrc",
  ".prettierrc",
  ".babelrc",
]);

/** Generated / huge lockfiles that are pure noise in a search index. */
const SKIP_FILES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "npm-shrinkwrap.json",
  "Cargo.lock",
  "poetry.lock",
  "Gemfile.lock",
  "composer.lock",
  "Pipfile.lock",
]);

/** Directories never worth walking when git isn't available to filter for us. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  ".gradle",
]);

const isIndexable = (rel: string): boolean => {
  const base = path.basename(rel);
  if (SKIP_FILES.has(base)) return false;
  if (KNOWN_TEXT_FILES.has(base)) return true;
  return TEXT_EXTENSIONS.has(path.extname(rel).toLowerCase());
};

/**
 * Lists repo-relative file paths via `git ls-files`, which only returns
 * tracked files and so respects `.gitignore` for free. Returns `null` when the
 * directory isn't a git checkout (or git is unavailable) so the caller can fall
 * back to a manual walk.
 */
async function gitTrackedFiles(repoRoot: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFile("git", ["ls-files", "-z"], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Lists the files in a checkout, preferring git's tracked set and falling back
 * to a filtered walk. Treats an *empty* git result as "fall back too": a local
 * copy lives inside the tool's gitignored `.cache/`, so `git ls-files` there
 * resolves to the parent repo and returns nothing — the walk is what we want.
 * Remote clones have their own `.git`, so they keep using their tracked set.
 */
async function listCheckoutFiles(repoRoot: string): Promise<string[]> {
  const tracked = await gitTrackedFiles(repoRoot);
  return tracked && tracked.length > 0 ? tracked : await walkFiles(repoRoot);
}

/** Recursive walk used when the repo isn't a git checkout. */
async function walkFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        results.push(path.relative(repoRoot, path.join(dir, entry.name)));
      }
    }
  };
  await walk(repoRoot);
  return results;
}

// ---------------------------------------------------------------------------
// Materialize: copy a local repo into the cache
// ---------------------------------------------------------------------------

/**
 * Enumerates every file to copy when snapshotting a local repo into the cache:
 * tracked files plus untracked-but-unignored files (so an uncommitted authored
 * `agent-docs/` is still captured), honoring `.gitignore`. Returns `null` when
 * the directory isn't a git checkout so the caller can fall back to a walk.
 */
async function gitListForCopy(repoRoot: string): Promise<string[] | null> {
  try {
    const args = [
      ["ls-files", "-z"],
      ["ls-files", "-z", "--others", "--exclude-standard"],
    ];
    const out = new Set<string>();
    for (const a of args) {
      const { stdout } = await execFile("git", a, {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024,
      });
      for (const f of stdout.split("\0")) if (f) out.add(f);
    }
    return [...out];
  } catch {
    return null;
  }
}

/**
 * Snapshots a local repo into `destDir` so it can be served from the cache like
 * a remote clone — keeping the user's working tree untouched. Copies tracked +
 * untracked-unignored files (or a filtered walk for non-git repos), so junk
 * like `node_modules`/`dist` is excluded for free. `destDir` is cleared first.
 */
export async function copyRepoToCache(
  srcRepoRoot: string,
  destDir: string,
): Promise<void> {
  const listed = await gitListForCopy(srcRepoRoot);
  const rels =
    listed && listed.length > 0 ? listed : await walkFiles(srcRepoRoot);

  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  for (const rel of rels) {
    const from = path.join(srcRepoRoot, rel);
    const to = path.join(destDir, rel);
    try {
      const s = await stat(from);
      if (!s.isFile()) continue;
      await mkdir(path.dirname(to), { recursive: true });
      await copyFile(from, to);
    } catch {
      // Skip anything that vanished or can't be read; best-effort snapshot.
    }
  }
}

/**
 * Reports whether a checkout's `agent-docs/` is tracked by git — i.e. authored
 * and committed, as opposed to a folder we generated (which is untracked).
 * Used to decide whether to treat a remote clone's docs as authored.
 */
export async function hasTrackedAgentDocs(
  checkoutDir: string,
): Promise<boolean> {
  try {
    const { stdout } = await execFile(
      "git",
      ["ls-files", "-z", "--", "agent-docs"],
      {
        cwd: checkoutDir,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return stdout.split("\0").some(Boolean);
  } catch {
    return false;
  }
}

/**
 * Best-effort removal of untracked files under `<checkoutDir>/agent-docs` so
 * stale synthesized docs don't linger beside newly-committed authored ones.
 */
export async function cleanUntrackedAgentDocs(
  checkoutDir: string,
): Promise<void> {
  try {
    await execFile("git", ["clean", "-fdq", "--", "agent-docs"], {
      cwd: checkoutDir,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    // Not a git repo or nothing to clean — fine.
  }
}

// ---------------------------------------------------------------------------
// Synthesis (no AI)
// ---------------------------------------------------------------------------

/** Cap how many exported symbols we list per file. */
const MAX_SYMBOLS_PER_FILE = 20;
/** Cap total code_refs attached to the consolidated modules doc. */
const MAX_MODULE_CODE_REFS = 150;
/** Cap directory-tree depth so the map stays scannable. */
const TREE_MAX_DEPTH = 3;
/** Cap README headings surfaced in the overview's table of contents. */
const MAX_README_HEADINGS = 15;

interface SynthDoc {
  /** Relative doc path under the agent-docs output dir, e.g. `overview.md`. */
  relName: string;
  id: string;
  title: string;
  kind: LoadedDoc["kind"];
  tags: string[];
  codeRefs: CodeRef[];
  body: string;
}

/**
 * A repo source file read for synthesis — only the fields the builders use.
 * Raw source is never served as a searchable doc (agents reach it via
 * `read_source_file`), so there's no need to model it as a full `LoadedDoc`.
 */
export interface SourceFile {
  /** Repo-relative POSIX path, e.g. `src/server.ts`. */
  relPath: string;
  /** Full file contents. */
  body: string;
}

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Reads and parses `package.json` at the repo root, or null if absent/invalid. */
async function readPackageJson(repoRoot: string): Promise<PackageJson | null> {
  try {
    const text = await readFile(path.join(repoRoot, "package.json"), "utf8");
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as PackageJson)
      : null;
  } catch {
    return null;
  }
}

/** Counts indexed files by extension, e.g. `{ ts: 40, md: 8 }`, biggest first. */
function languageBreakdown(
  relPaths: readonly string[],
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const rel of relPaths) {
    const ext = path.extname(rel).toLowerCase().replace(/^\./, "") || "(none)";
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

/** First path segment of a repo-relative path, or "" for root-level files. */
const topSegment = (rel: string): string => {
  const idx = rel.indexOf("/");
  return idx === -1 ? "" : rel.slice(0, idx);
};

/**
 * Per-language regexes for best-effort extraction of exported/public symbols.
 * Pure regex — intentionally shallow. Languages we don't model yield [].
 */
const SYMBOL_PATTERNS: ReadonlyArray<{
  exts: readonly string[];
  patterns: readonly RegExp[];
}> = [
  {
    exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    patterns: [
      /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm,
    ],
  },
  {
    exts: [".py"],
    patterns: [
      /^(?:async\s+)?def\s+([A-Za-z_]\w*)/gm,
      /^class\s+([A-Za-z_]\w*)/gm,
    ],
  },
  {
    // Exported Go identifiers start with an uppercase letter.
    exts: [".go"],
    patterns: [/^func\s+(?:\([^)]*\)\s+)?([A-Z]\w*)/gm, /^type\s+([A-Z]\w*)/gm],
  },
  {
    exts: [".rs"],
    patterns: [
      /^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:unsafe\s+)?(?:fn|struct|enum|trait|mod|const|static|type)\s+([A-Za-z_]\w*)/gm,
    ],
  },
  {
    exts: [".java", ".kt", ".kts"],
    patterns: [
      /^\s*(?:public\s+|open\s+|internal\s+)?(?:final\s+|abstract\s+|sealed\s+|data\s+)?(?:class|interface|enum|object|fun)\s+([A-Za-z_]\w*)/gm,
    ],
  },
  {
    exts: [".rb"],
    patterns: [
      /^\s*(?:class|module)\s+([A-Z]\w*)/gm,
      /^\s*def\s+([A-Za-z_]\w*[!?=]?)/gm,
    ],
  },
  {
    exts: [".cs"],
    patterns: [
      /^\s*(?:public|internal|protected|private)?\s*(?:static\s+|abstract\s+|sealed\s+|partial\s+)*(?:class|interface|struct|enum|record)\s+([A-Za-z_]\w*)/gm,
    ],
  },
  {
    exts: [".php"],
    patterns: [
      /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+([A-Za-z_]\w*)/gm,
      /^\s*function\s+([A-Za-z_]\w*)/gm,
    ],
  },
  {
    exts: [".swift"],
    patterns: [
      /^\s*(?:public\s+|open\s+|internal\s+)?(?:final\s+)?(?:class|struct|enum|protocol|func|extension)\s+([A-Za-z_]\w*)/gm,
    ],
  },
  {
    exts: [".scala"],
    patterns: [
      /^\s*(?:final\s+|sealed\s+|abstract\s+|case\s+)?(?:class|object|trait|def|val)\s+([A-Za-z_]\w*)/gm,
    ],
  },
  {
    exts: [".c", ".h", ".cc", ".cpp", ".hpp", ".hh", ".cxx", ".mm"],
    patterns: [/^\s*(?:class|struct|enum|namespace)\s+([A-Za-z_]\w*)/gm],
  },
];

const PATTERNS_BY_EXT = new Map<string, readonly RegExp[]>();
for (const { exts, patterns } of SYMBOL_PATTERNS) {
  for (const ext of exts) PATTERNS_BY_EXT.set(ext, patterns);
}

/**
 * Best-effort extraction of exported/public symbol names from a source file.
 * Pure regex — intentionally shallow. Returns [] for languages we don't model.
 */
function extractSymbols(rel: string, body: string): string[] {
  const patterns = PATTERNS_BY_EXT.get(path.extname(rel).toLowerCase());
  if (!patterns) return [];
  const out = new Set<string>();
  for (const re of patterns) {
    for (const m of body.matchAll(re)) {
      if (m[1]) out.add(m[1]);
    }
  }
  return [...out].slice(0, MAX_SYMBOLS_PER_FILE);
}

/** Renders a pruned directory tree (dirs + file counts) up to TREE_MAX_DEPTH. */
function directoryTree(relPaths: readonly string[]): string {
  const dirFileCounts = new Map<string, number>();
  const childDirs = new Map<string, Set<string>>();

  const ensure = (dir: string): void => {
    if (!childDirs.has(dir)) childDirs.set(dir, new Set());
    if (!dirFileCounts.has(dir)) dirFileCounts.set(dir, 0);
  };
  ensure("");

  for (const rel of relPaths) {
    const parts = rel.split("/");
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i] ?? "";
      const parent = prefix;
      prefix = prefix ? `${prefix}/${seg}` : seg;
      ensure(prefix);
      childDirs.get(parent)?.add(prefix);
    }
    dirFileCounts.set(prefix, (dirFileCounts.get(prefix) ?? 0) + 1);
  }

  const lines: string[] = [];
  const render = (dir: string, depth: number): void => {
    if (depth > TREE_MAX_DEPTH) return;
    const kids = [...(childDirs.get(dir) ?? [])].sort();
    for (const kid of kids) {
      const name = kid.slice(dir ? dir.length + 1 : 0);
      const count = dirFileCounts.get(kid) ?? 0;
      lines.push(
        `${"  ".repeat(depth)}${name}/${count > 0 ? `  (${count} files)` : ""}`,
      );
      render(kid, depth + 1);
    }
  };
  render("", 0);
  return lines.length > 0 ? lines.join("\n") : "(no directories)";
}

/** Resolves package.json `main`/`bin` into code_refs. */
function entryPointRefs(pkg: PackageJson | null): CodeRef[] {
  const refs: CodeRef[] = [];
  if (!pkg) return refs;
  if (typeof pkg.main === "string")
    refs.push({ path: pkg.main, description: "main" });
  if (typeof pkg.bin === "string") {
    refs.push({ path: pkg.bin, description: "bin" });
  } else if (pkg.bin && typeof pkg.bin === "object") {
    for (const [name, p] of Object.entries(pkg.bin)) {
      refs.push({ path: p, description: `bin: ${name}` });
    }
  }
  return refs;
}

/** Detects conventional entry/key files among the indexed paths. */
function keyFileRefs(relPaths: readonly string[]): CodeRef[] {
  const ENTRY =
    /(^|\/)(index|main|app|server|cli|mod)\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|rb|java|kt)$/i;
  const CMD_MAIN = /(^|\/)cmd\/[^/]+\/main\.go$/i;
  const refs: CodeRef[] = [];
  for (const rel of relPaths) {
    if (ENTRY.test(rel) || CMD_MAIN.test(rel))
      refs.push({ path: rel, description: "entry point" });
  }
  return refs.slice(0, 12);
}

const tagsFor = (kind: string, repoName: string): string[] => [
  "synthetic",
  kind,
  repoName,
];

/** Builds the `overview` doc from package.json, README, and language stats. */
function buildOverview(
  repoName: string,
  pkg: PackageJson | null,
  sourceDocs: readonly SourceFile[],
): SynthDoc {
  const relPaths = sourceDocs.map((d) => d.relPath);
  const langs = languageBreakdown(relPaths)
    .slice(0, 8)
    .map(([ext, n]) => `${ext} (${n})`)
    .join(", ");

  const codeRefs: CodeRef[] = [];
  const lines: string[] = [];
  lines.push(`# ${pkg?.name ?? repoName}`, "");
  if (pkg?.description) lines.push(pkg.description, "");

  lines.push("## At a glance", "");
  if (pkg?.version) lines.push(`- **Version:** ${pkg.version}`);
  lines.push(`- **Indexed files:** ${sourceDocs.length}`);
  if (langs) lines.push(`- **Languages:** ${langs}`);

  const entryPoints = entryPointRefs(pkg);
  if (entryPoints.length > 0) {
    const uniq = [...new Set(entryPoints.map((r) => r.path))];
    lines.push(`- **Entry points:** ${uniq.map((p) => `\`${p}\``).join(", ")}`);
  }
  lines.push("");

  if (pkg) {
    codeRefs.push({ repo: repoName, path: "package.json" });
    const scripts = Object.entries(pkg.scripts ?? {});
    if (scripts.length > 0) {
      lines.push("## Scripts", "", "| Script | Command |", "| --- | --- |");
      for (const [name, cmd] of scripts)
        lines.push(`| \`${name}\` | \`${cmd}\` |`);
      lines.push("");
    }
    const deps = Object.keys(pkg.dependencies ?? {});
    const devDeps = Object.keys(pkg.devDependencies ?? {});
    if (deps.length > 0 || devDeps.length > 0) {
      lines.push("## Dependencies", "");
      if (deps.length > 0) lines.push(`**Runtime:** ${deps.join(", ")}`, "");
      if (devDeps.length > 0) lines.push(`**Dev:** ${devDeps.join(", ")}`, "");
    }
  }

  const readme = sourceDocs.find((d) => /^readme(\.[^/]+)?$/i.test(d.relPath));
  if (readme) {
    codeRefs.push({ repo: repoName, path: readme.relPath });

    const headings: string[] = [];
    let inFence = false;
    for (const line of readme.body.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence; // ignore `#` comments inside fenced code blocks
        continue;
      }
      if (inFence) continue;
      const m = line.match(/^(#{1,3})\s+(.*\S)\s*$/);
      if (m) headings.push(`${"  ".repeat((m[1]?.length ?? 1) - 1)}- ${m[2]}`);
    }
    const toc = headings.slice(1, MAX_README_HEADINGS + 1); // skip the title
    if (toc.length > 0) {
      lines.push("## README contents", "", ...toc, "");
    }

    const excerpt = readme.body
      .split("\n")
      .filter((l) => !l.startsWith("# "))
      .join("\n")
      .trim()
      .split(/\n\s*\n/)[0]
      ?.trim();
    if (excerpt) lines.push("## From the README", "", excerpt, "");
  }

  return {
    relName: "overview.md",
    id: "overview",
    title: pkg?.name ?? repoName,
    kind: "overview",
    tags: tagsFor("overview", repoName),
    codeRefs,
    body: lines.join("\n"),
  };
}

/** Builds the `architecture` doc — directory tree + top-level area table + key files. */
function buildArchitecture(
  repoName: string,
  pkg: PackageJson | null,
  sourceDocs: readonly SourceFile[],
): SynthDoc {
  const relPaths = sourceDocs.map((d) => d.relPath);

  const areaCounts = new Map<string, number>();
  for (const rel of relPaths) {
    const seg = topSegment(rel) || "(root)";
    areaCounts.set(seg, (areaCounts.get(seg) ?? 0) + 1);
  }
  const areas = [...areaCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  const lines: string[] = [];
  lines.push("# Architecture (file map)", "");
  lines.push(
    "Programmatic map of the repository — directory structure and where files live. " +
      "Data flows, boundaries, and design rationale are **not** captured here (those need the AI orchestrator).",
    "",
  );

  lines.push("## Top-level areas", "", "| Area | Files |", "| --- | --- |");
  for (const [area, n] of areas) lines.push(`| \`${area}\` | ${n} |`);
  lines.push("");

  lines.push(
    "## Directory tree",
    "",
    "```",
    directoryTree(relPaths),
    "```",
    "",
  );

  const entryPoints = entryPointRefs(pkg);
  const keyFiles = keyFileRefs(relPaths);
  const allEntry = [...entryPoints, ...keyFiles];
  if (allEntry.length > 0) {
    lines.push("## Entry & key files", "");
    const seen = new Set<string>();
    for (const r of allEntry) {
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      lines.push(
        `- \`${r.path}\`${r.description ? ` — ${r.description}` : ""}`,
      );
    }
    lines.push("");
  }

  const codeRefs = [...entryPoints, ...keyFiles].map((r) => ({
    repo: repoName,
    ...r,
  }));

  return {
    relName: "architecture.md",
    id: "architecture",
    title: "Architecture (file map)",
    kind: "architecture",
    tags: tagsFor("architecture", repoName),
    codeRefs,
    body: lines.join("\n"),
  };
}

/**
 * Builds a single consolidated `modules` doc — one section per top-level source
 * area, each with a file + exported-symbol table. Replaces the per-area file
 * explosion of the old lite mode so the synthesized set stays compact.
 */
function buildModules(
  repoName: string,
  sourceDocs: readonly SourceFile[],
): SynthDoc | null {
  const byArea = new Map<string, SourceFile[]>();
  for (const doc of sourceDocs) {
    const seg = topSegment(doc.relPath);
    if (!seg) continue; // root-level loose files: covered by overview/architecture
    if (!byArea.has(seg)) byArea.set(seg, []);
    byArea.get(seg)?.push(doc);
  }
  if (byArea.size === 0) return null;

  const lines: string[] = [];
  lines.push("# Modules (area map)", "");
  lines.push(
    "Each top-level source area with its files and regex-extracted exported symbols. " +
      "Shallow by design — run the AI orchestrator for responsibilities and relationships.",
    "",
  );

  const codeRefs: CodeRef[] = [];
  for (const [area, docs] of [...byArea.entries()].sort()) {
    const sorted = [...docs].sort((a, b) => a.relPath.localeCompare(b.relPath));

    lines.push(`## \`${area}/\` — ${docs.length} file(s)`, "");
    lines.push("| File | Exported symbols |", "| --- | --- |");
    for (const d of sorted) {
      const syms = extractSymbols(d.relPath, d.body);
      const cell =
        syms.length > 0 ? syms.map((s) => `\`${s}\``).join(", ") : "—";
      lines.push(`| \`${d.relPath}\` | ${cell} |`);
      if (codeRefs.length < MAX_MODULE_CODE_REFS) {
        codeRefs.push({ repo: repoName, path: d.relPath });
      }
    }
    lines.push("");
  }

  return {
    relName: "modules.md",
    id: "modules",
    title: "Modules (area map)",
    kind: "module",
    tags: tagsFor("module", repoName),
    codeRefs,
    body: lines.join("\n"),
  };
}

/**
 * Builds a compact `project-details` doc from build/test/run/config/deploy
 * signals detected purely by file presence. Returns null when nothing is found,
 * so a bare repo doesn't get an empty doc.
 */
function buildProjectDetails(
  repoName: string,
  pkg: PackageJson | null,
  sourceDocs: readonly SourceFile[],
): SynthDoc | null {
  const relPaths = sourceDocs.map((d) => d.relPath);
  const has = (re: RegExp): boolean => relPaths.some((p) => re.test(p));
  const refs: CodeRef[] = [];
  const sections: string[][] = [];

  // Build / test / run commands.
  const scripts = Object.entries(pkg?.scripts ?? {});
  const cmdLines: string[] = [];
  if (scripts.length > 0) {
    for (const key of ["build", "test", "start", "dev", "lint", "typecheck"]) {
      const cmd = pkg?.scripts?.[key];
      if (cmd) cmdLines.push(`- \`${key}\`: \`${cmd}\``);
    }
  }
  if (has(/(^|\/)Makefile$/))
    cmdLines.push("- `Makefile` present — `make <target>`");
  if (cmdLines.length > 0)
    sections.push(["## Build & run", "", ...cmdLines, ""]);

  // Testing.
  const testDirs = [
    ...new Set(
      relPaths
        .map((p) => p.match(/(^|\/)(tests?|__tests__|spec|e2e)(\/|$)/i)?.[2])
        .filter((d): d is string => Boolean(d)),
    ),
  ];
  const testFiles = relPaths.filter(
    (p) => /\.(test|spec)\.[a-z]+$/i.test(p) || /_test\.go$/i.test(p),
  );
  const devDeps = Object.keys(pkg?.devDependencies ?? {});
  const runner = [
    "vitest",
    "jest",
    "mocha",
    "ava",
    "playwright",
    "cypress",
  ].find((r) => devDeps.includes(r));
  const testLines: string[] = [];
  if (runner) testLines.push(`- **Runner:** ${runner}`);
  if (testDirs.length > 0)
    testLines.push(
      `- **Test dirs:** ${testDirs.map((d) => `\`${d}/\``).join(", ")}`,
    );
  if (testFiles.length > 0)
    testLines.push(`- **Test files:** ${testFiles.length}`);
  if (testLines.length > 0) sections.push(["## Testing", "", ...testLines, ""]);

  // Configuration & environment.
  const configFiles = relPaths.filter((p) =>
    /(^|\/)(tsconfig(\.\w+)?\.json|\.eslintrc(\.\w+)?|\.prettierrc(\.\w+)?|.*\.config\.(ts|js|mjs|cjs|json)|\.env(\.[\w.-]+)?|.*\.env)$/i.test(
      p,
    ),
  );
  if (configFiles.length > 0) {
    const shown = configFiles.slice(0, 15);
    for (const p of shown) refs.push({ repo: repoName, path: p });
    sections.push([
      "## Configuration",
      "",
      ...shown.map((p) => `- \`${p}\``),
      ...(configFiles.length > shown.length
        ? [`- …and ${configFiles.length - shown.length} more`]
        : []),
      "",
    ]);
  }

  // Containerization / CI / deployment.
  const deployLines: string[] = [];
  const addRef = (p: string): void => {
    refs.push({ repo: repoName, path: p });
  };
  for (const p of relPaths) {
    if (/(^|\/)Dockerfile$/.test(p)) {
      deployLines.push(`- Docker: \`${p}\``);
      addRef(p);
    } else if (/(^|\/)(docker-compose|compose)\.ya?ml$/i.test(p)) {
      deployLines.push(`- Compose: \`${p}\``);
      addRef(p);
    } else if (/(^|\/)\.github\/workflows\/.+\.ya?ml$/i.test(p)) {
      deployLines.push(`- CI: \`${p}\``);
      addRef(p);
    } else if (/(^|\/)\.gitlab-ci\.ya?ml$/i.test(p)) {
      deployLines.push(`- CI: \`${p}\``);
      addRef(p);
    } else if (/(^|\/)(helm|charts|k8s|kubernetes|deploy)\//i.test(p)) {
      deployLines.push(`- Deploy: \`${p}\``);
      addRef(p);
    } else if (/\.tf$/i.test(p)) {
      deployLines.push(`- Terraform: \`${p}\``);
      addRef(p);
    }
  }
  if (deployLines.length > 0) {
    const shown = [...new Set(deployLines)].slice(0, 20);
    sections.push(["## Containerization, CI & deployment", "", ...shown, ""]);
  }

  if (sections.length === 0) return null;

  const lines: string[] = ["# Project details", ""];
  lines.push(
    "Build, test, configuration, and deployment signals detected from the repo's files.",
    "",
  );
  for (const s of sections) lines.push(...s);

  return {
    relName: "project-details.md",
    id: "project-details",
    title: "Project details",
    kind: "project-details",
    tags: tagsFor("project-details", repoName),
    codeRefs: refs.slice(0, MAX_MODULE_CODE_REFS),
    body: lines.join("\n"),
  };
}

/** Materializes a synthesized doc to disk and wraps it as a LoadedDoc. */
async function persist(synth: SynthDoc, outDir: string): Promise<LoadedDoc> {
  const absPath = path.join(outDir, synth.relName);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, synth.body, "utf8");
  return {
    id: synth.id,
    title: synth.title,
    kind: synth.kind,
    tags: synth.tags,
    sources: [],
    codeRefs: synth.codeRefs,
    absPath,
    relPath: synth.relName,
    body: synth.body,
    raw: synth.body,
    extra: {},
  };
}

// ---------------------------------------------------------------------------
// Source indexing
// ---------------------------------------------------------------------------

/**
 * Reads a repo's indexable source files into memory to drive synthesis. Each
 * file becomes a `{ relPath, body }` pair — raw source is never served as a
 * searchable doc (agents reach it via `read_source_file`), so there's no need
 * to model it as a full `LoadedDoc`. File selection prefers `git ls-files`
 * (tracked, honoring `.gitignore`) and falls back to a filtered walk;
 * binary/oversized/lockfile entries are skipped regardless.
 */
export async function indexSourceDocs(
  checkoutDir: string,
): Promise<SourceFile[]> {
  const all = await listCheckoutFiles(checkoutDir);
  // Never read files under `agent-docs/`: in synthetic mode that folder is
  // freshly synthesized (and already removed before this runs); in authored
  // mode it holds the curated docs, which are loaded separately. The git
  // `ls-files` path returns tracked `agent-docs/` files, so this filter — not
  // SKIP_DIRS — is what excludes them.
  const docsPrefix = `${AGENT_DOCS_FOLDER}/`;
  const candidates = all
    .filter((rel) => !rel.startsWith(docsPrefix))
    .filter(isIndexable)
    .sort();

  const files: SourceFile[] = [];
  for (const rel of candidates) {
    const absPath = path.join(checkoutDir, rel);
    try {
      const s = await stat(absPath);
      if (!s.isFile() || s.size > RAW_MAX_FILE_BYTES) continue;
      files.push({ relPath: rel, body: await readFile(absPath, "utf8") });
    } catch {
      continue;
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const AGENT_DOCS_FOLDER = "agent-docs";

/**
 * Synthetic-mode loader. Runs over an already-materialized checkout (a local copy or
 * a remote clone). Reads its source files, then synthesizes a compact set of
 * structure docs (≤5 files) into `<checkoutDir>/agent-docs/`, clearing any docs
 * we generated on a previous load first. Returns only the synthesized docs (raw
 * source files are reachable via `read_source_file`, not the search index); an
 * empty array when there's nothing indexable.
 */
export async function loadSyntheticRepoDocs(
  checkoutDir: string,
  repoName: string,
): Promise<LoadedDoc[]> {
  // Clear any docs we generated on a previous load *before* indexing, so they
  // aren't picked up as source files (relevant when the checkout persists, as
  // with a remote clone served via a non-git copy on a later run).
  const outDir = path.join(checkoutDir, AGENT_DOCS_FOLDER);
  await rm(outDir, { recursive: true, force: true });

  const sourceDocs = await indexSourceDocs(checkoutDir);
  if (sourceDocs.length === 0) return [];

  await mkdir(outDir, { recursive: true });

  const pkg = await readPackageJson(checkoutDir);
  const synth: SynthDoc[] = [
    buildOverview(repoName, pkg, sourceDocs),
    buildArchitecture(repoName, pkg, sourceDocs),
  ];
  const modules = buildModules(repoName, sourceDocs);
  if (modules) synth.push(modules);
  const details = buildProjectDetails(repoName, pkg, sourceDocs);
  if (details) synth.push(details);

  const synthDocs = await Promise.all(synth.map((s) => persist(s, outDir)));
  return synthDocs;
}
