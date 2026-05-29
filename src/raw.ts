import { execFile as execFileCb } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { LoadedDoc } from "./loader.js";

const execFile = promisify(execFileCb);

/** Files larger than this are skipped — they bloat the index and are rarely useful prose. */
const RAW_MAX_FILE_BYTES = 512 * 1024;

/**
 * Text/code extensions worth indexing. Anything not listed here (images,
 * fonts, archives, compiled artifacts, …) is skipped so the search index
 * stays free of binary noise.
 */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc",
  ".md", ".mdx", ".txt", ".rst", ".adoc",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".groovy",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".php", ".swift", ".scala",
  ".clj", ".cljs", ".ex", ".exs", ".erl", ".hs", ".lua", ".dart", ".m", ".mm",
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat",
  ".sql", ".graphql", ".gql", ".proto", ".prisma",
  ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env", ".properties",
  ".html", ".htm", ".css", ".scss", ".sass", ".less", ".vue", ".svelte",
  ".xml", ".gradle", ".tf", ".tfvars", ".r",
]);

/** Extensionless filenames that are still worth indexing. */
const KNOWN_TEXT_FILES: ReadonlySet<string> = new Set([
  "Dockerfile", "Makefile", "Rakefile", "Gemfile", "Procfile", "Brewfile",
  "README", "LICENSE", "CHANGELOG", "AUTHORS", "NOTICE",
  ".gitignore", ".dockerignore", ".editorconfig", ".npmrc", ".nvmrc",
  ".eslintrc", ".prettierrc", ".babelrc",
]);

/** Generated / huge lockfiles that are pure noise in a search index. */
const SKIP_FILES: ReadonlySet<string> = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json",
  "Cargo.lock", "poetry.lock", "Gemfile.lock", "composer.lock", "Pipfile.lock",
]);

/** Directories never worth walking when git isn't available to filter for us. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", "vendor",
  "coverage", ".next", ".nuxt", ".turbo", ".cache", "__pycache__", ".venv",
  "venv", ".idea", ".vscode", ".gradle",
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

/** Maps a file extension to a coarse language tag for filtering. */
const langTag = (rel: string): string | null => {
  const ext = path.extname(rel).toLowerCase().replace(/^\./, "");
  return ext.length > 0 ? ext : null;
};

/**
 * Builds searchable docs straight from a repo's source files — the fallback
 * when a repo has no generated `agent-docs/`. Each indexable file becomes one
 * `LoadedDoc` whose body is the file's contents and which carries a self
 * `code_ref` so an agent can pull the full file via `read_source_file`.
 *
 * File selection prefers `git ls-files` (tracked files, honoring `.gitignore`)
 * and falls back to a filtered directory walk. Binary/oversized/lockfile
 * entries are skipped regardless.
 */
export async function loadRawRepoDocs(
  repoRoot: string,
  repoName: string,
): Promise<LoadedDoc[]> {
  const all = (await gitTrackedFiles(repoRoot)) ?? (await walkFiles(repoRoot));
  const candidates = all.filter(isIndexable).sort();

  const docs: LoadedDoc[] = [];
  for (const rel of candidates) {
    const absPath = path.join(repoRoot, rel);

    let body: string;
    try {
      const s = await stat(absPath);
      if (!s.isFile() || s.size > RAW_MAX_FILE_BYTES) continue;
      body = await readFile(absPath, "utf8");
    } catch {
      continue;
    }

    const tags = ["raw"];
    const lang = langTag(rel);
    if (lang) tags.push(lang);

    docs.push({
      id: rel,
      title: rel,
      kind: "source",
      tags,
      sources: [],
      codeRefs: [{ repo: repoName, path: rel }],
      absPath,
      relPath: rel,
      body,
      raw: body,
      extra: {},
    });
  }

  return docs;
}
