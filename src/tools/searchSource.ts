import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SourceRoot } from "../config.js";
import { errorResult, jsonResult } from "./util.js";

const MAX_RESULTS_DEFAULT = 50;
const MAX_FILE_BYTES_DEFAULT = 1024 * 1024;
const SNIPPET_MAX_CHARS = 240;
const BINARY_SNIFF_BYTES = 8 * 1024;

/** Directories never worth grepping; skipped during the walk. */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  "coverage",
  ".next",
  "out",
]);

export interface SearchSourceInput {
  query: string;
  repo?: string;
  glob?: string;
  case_sensitive?: boolean;
  max_results?: number;
  max_file_bytes?: number;
}

export interface SourceMatch {
  repo: string;
  path: string;
  line: number;
  text: string;
}

export interface SearchSourceResult {
  query: string;
  repo: string | null;
  count: number;
  /** True if the max_results cap was hit and more matches may exist. */
  truncated: boolean;
  matches: readonly SourceMatch[];
}

/**
 * Compiles a path glob to a RegExp matching a root-relative POSIX path.
 * Supports `*` (any run not crossing `/`), `**` (any depth, incl. `/`), and
 * `?` (a single non-`/` char). All other regex metacharacters are escaped.
 */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**` matches across path separators.
        re += ".*";
        i++;
        // Swallow a following slash so `**/foo` also matches a top-level `foo`.
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/** Heuristic: a NUL byte in the first chunk means a binary file. */
function looksBinary(buf: Buffer): boolean {
  const end = Math.min(buf.byteLength, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export async function searchSourceFiles(
  roots: readonly SourceRoot[],
  input: SearchSourceInput,
): Promise<SearchSourceResult> {
  let targets: readonly SourceRoot[];
  if (input.repo !== undefined) {
    const root = roots.find((r) => r.name === input.repo);
    if (!root) {
      const known = roots.map((r) => r.name).join(", ") || "(none configured)";
      throw new Error(
        `Unknown source root "${input.repo}". Configured roots: ${known}.`,
      );
    }
    targets = [root];
  } else {
    targets = roots;
  }

  let regex: RegExp;
  try {
    regex = new RegExp(input.query, input.case_sensitive ? "" : "i");
  } catch (err) {
    throw new Error(
      `Invalid regex "${input.query}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const globRe = input.glob ? globToRegExp(input.glob) : null;
  const maxResults =
    input.max_results && input.max_results > 0
      ? input.max_results
      : MAX_RESULTS_DEFAULT;
  const maxFileBytes =
    input.max_file_bytes && input.max_file_bytes > 0
      ? input.max_file_bytes
      : MAX_FILE_BYTES_DEFAULT;

  const matches: SourceMatch[] = [];
  let truncated = false;

  // Depth-first walk of one root. `rel` is the POSIX path relative to the root.
  async function walk(repo: string, dirAbs: string, rel: string): Promise<void> {
    if (truncated) return;
    const entries = await readdir(dirAbs, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (truncated) return;
      // Don't follow symlinks — keeps the walk inside the configured root.
      if (entry.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(dirAbs, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(repo, childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (globRe && !globRe.test(childRel)) continue;

      const buf = await readFile(childAbs).catch(() => null);
      if (!buf) continue;
      if (buf.byteLength > maxFileBytes) continue;
      if (looksBinary(buf)) continue;

      const lines = buf.toString("utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!regex.test(line)) continue;
        matches.push({
          repo,
          path: childRel,
          line: i + 1,
          text: line.slice(0, SNIPPET_MAX_CHARS),
        });
        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }
      }
    }
  }

  for (const root of targets) {
    if (truncated) break;
    await walk(root.name, root.path, "");
  }

  return {
    query: input.query,
    repo: input.repo ?? null,
    count: matches.length,
    truncated,
    matches,
  };
}

export const makeSearchSourceTool = (roots: readonly SourceRoot[]) =>
  ({
    name: "search_source_files",
    config: {
      title: "Search source files",
      description:
        "Grep the configured source-code roots for a regular expression and return matching files with line numbers. " +
        "This is raw code search — reach for it when you need source the agent docs don't cover; otherwise start with " +
        "`search_agent_docs`. Use it to locate where a symbol, string, or pattern lives before reading the file with read_source_file. " +
        "Pass `repo` to scope the search to one root (otherwise all configured roots are searched), and `glob` to " +
        "restrict which files are scanned (e.g. '**/*.ts'). Binary files, oversized files, and common build/vendor " +
        "directories (node_modules, .git, dist, …) are skipped. Each match's `path` is relative to its source root " +
        "and can be passed directly to read_source_file.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Regular expression (JS syntax) matched against each line."),
        repo: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Source root name to scope the search to. Omit to search all configured roots.",
          ),
        glob: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Path glob (relative to the source root) limiting which files are scanned, e.g. '**/*.ts'. Supports *, **, and ?.",
          ),
        case_sensitive: z
          .boolean()
          .optional()
          .describe("Match case-sensitively. Defaults to false (case-insensitive)."),
        max_results: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            `Max matching lines to return. Defaults to ${MAX_RESULTS_DEFAULT}. The result's \`truncated\` flag reports whether the cap was hit.`,
          ),
        max_file_bytes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            `Skip files larger than this many bytes. Defaults to ${MAX_FILE_BYTES_DEFAULT}.`,
          ),
      },
    },
    handler: async (input: SearchSourceInput) => {
      if (roots.length === 0) {
        return errorResult(
          "No source roots configured. Start the server with --source-root /path/to/repo " +
            "(repeatable) or set AGENT_SOURCE_ROOTS=/abs/path1,/abs/path2.",
        );
      }
      try {
        return jsonResult(await searchSourceFiles(roots, input));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  }) as const;
