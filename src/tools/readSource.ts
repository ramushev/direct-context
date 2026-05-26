import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SourceRoot } from "../config.js";
import { errorResult, jsonResult } from "./util.js";

const MAX_BYTES_DEFAULT = 256 * 1024;

export interface ReadSourceInput {
  repo: string;
  path: string;
  max_bytes?: number;
}

export interface ReadSourceResult {
  repo: string;
  path: string;
  bytes: number;
  truncated: boolean;
  content: string;
}

async function resolveUnderRoot(rootAbs: string, rel: string): Promise<string> {
  const joined = path.resolve(rootAbs, rel);
  const realRoot = await realpath(rootAbs);

  // File may not exist yet — fall back to realRoot+rel so the boundary check
  // uses a consistent base (avoids false rejects on systems where rootAbs
  // contains a symlink, e.g. macOS /tmp → /private/tmp).
  const realJoined = await realpath(joined).catch(() => path.join(realRoot, rel));

  const withSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (realJoined !== realRoot && !realJoined.startsWith(withSep)) {
    throw new Error(
      `Path "${rel}" resolves outside the configured source root.`,
    );
  }
  return realJoined;
}

export async function readSourceFile(
  roots: readonly SourceRoot[],
  input: ReadSourceInput,
): Promise<ReadSourceResult> {
  const root = roots.find((r) => r.name === input.repo);
  if (!root) {
    const known = roots.map((r) => r.name).join(", ") || "(none configured)";
    throw new Error(
      `Unknown source root "${input.repo}". Configured roots: ${known}. ` +
        `Start the server with --source-root /path/to/${input.repo} (or set AGENT_SOURCE_ROOTS).`,
    );
  }

  const abs = await resolveUnderRoot(root.path, input.path);
  const s = await stat(abs).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`"${input.path}" not found in "${input.repo}".`);
    throw new Error(`Cannot stat "${input.path}": ${code ?? "unknown error"}`);
  });
  if (!s.isFile()) {
    throw new Error(`"${input.path}" is not a regular file.`);
  }

  const cap =
    input.max_bytes && input.max_bytes > 0 ? input.max_bytes : MAX_BYTES_DEFAULT;
  const buf = await readFile(abs).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`"${input.path}" not found in "${input.repo}".`);
    throw new Error(`Cannot read "${input.path}": ${code ?? "unknown error"}`);
  });
  const truncated = buf.byteLength > cap;
  const sliced = truncated ? buf.subarray(0, cap) : buf;

  return {
    repo: input.repo,
    path: input.path,
    bytes: buf.byteLength,
    truncated,
    content: sliced.toString("utf8"),
  };
}

export const makeReadSourceTool = (roots: readonly SourceRoot[]) =>
  ({
    name: "read_source_file",
    config: {
      title: "Read source file",
      description:
        "Read a file from a configured source-code root. Use this after consulting agent docs to look at the real implementation. " +
        "Paths are resolved relative to the named --source-root and rejected if they escape it. " +
        "Agent docs produced by the built-in collect prompts carry a `code_refs:` frontmatter block listing " +
        "`{ repo, path }` entries that can be passed directly to this tool.",
      inputSchema: {
        repo: z
          .string()
          .min(1)
          .describe(
            "Source root name (basename of the path passed via --source-root, matches the doc-id prefix in multi-repo mode).",
          ),
        path: z
          .string()
          .min(1)
          .describe("File path relative to the source root, e.g. 'src/server.ts'."),
        max_bytes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(`Max bytes to return. Defaults to ${MAX_BYTES_DEFAULT}.`),
      },
    },
    handler: async (input: ReadSourceInput) => {
      if (roots.length === 0) {
        return errorResult(
          "No source roots configured. Start the server with --source-root /path/to/repo " +
            "(repeatable) or set AGENT_SOURCE_ROOTS=/abs/path1,/abs/path2.",
        );
      }
      try {
        return jsonResult(await readSourceFile(roots, input));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  }) as const;

export interface ListDirectoryInput {
  repo: string;
  path: string;
}

export interface DirEntry {
  name: string;
  /** Path relative to the source root — pass directly to read_source_file. */
  path: string;
  type: "file" | "dir";
}

export interface ListDirectoryResult {
  repo: string;
  path: string;
  entries: readonly DirEntry[];
}

export async function listDirectory(
  roots: readonly SourceRoot[],
  input: ListDirectoryInput,
): Promise<ListDirectoryResult> {
  const root = roots.find((r) => r.name === input.repo);
  if (!root) {
    const known = roots.map((r) => r.name).join(", ") || "(none configured)";
    throw new Error(
      `Unknown source root "${input.repo}". Configured roots: ${known}.`,
    );
  }

  const abs = await resolveUnderRoot(root.path, input.path);
  const s = await stat(abs).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`"${input.path}" not found in "${input.repo}".`);
    throw new Error(`Cannot stat "${input.path}": ${code ?? "unknown error"}`);
  });
  if (!s.isDirectory()) {
    throw new Error(`"${input.path}" is not a directory.`);
  }

  const raw = await readdir(abs, { withFileTypes: true }).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(`Cannot read directory "${input.path}": ${code ?? "unknown error"}`);
  });

  const entries: DirEntry[] = [];
  for (const entry of raw) {
    const entryPath = path.join(input.path, entry.name);
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, path: entryPath, type: "dir" });
    } else if (entry.isFile()) {
      entries.push({ name: entry.name, path: entryPath, type: "file" });
    }
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { repo: input.repo, path: input.path, entries };
}

export const makeListDirectoryTool = (roots: readonly SourceRoot[]) =>
  ({
    name: "list_source_dir",
    config: {
      title: "List source directory",
      description:
        "List files and subdirectories inside a directory in a configured source root. " +
        "Use this when a code_ref points to a folder rather than a specific file. " +
        "Each entry's `path` is relative to the source root and can be passed directly to read_source_file.",
      inputSchema: {
        repo: z
          .string()
          .min(1)
          .describe("Source root name, same as used by read_source_file."),
        path: z
          .string()
          .min(1)
          .describe("Directory path relative to the source root, e.g. 'src/pages/Workers/'."),
      },
    },
    handler: async (input: ListDirectoryInput) => {
      if (roots.length === 0) {
        return errorResult(
          "No source roots configured. Start the server with --source-root /path/to/repo " +
            "(repeatable) or set AGENT_SOURCE_ROOTS=/abs/path1,/abs/path2.",
        );
      }
      try {
        return jsonResult(await listDirectory(roots, input));
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  }) as const;

export const makeListSourceRootsTool = (roots: readonly SourceRoot[]) =>
  ({
    name: "list_source_roots",
    config: {
      title: "List source roots",
      description:
        "List the source-code roots the server is configured to read from. Use this to discover what repos read_source_file can access.",
      inputSchema: {},
    },
    handler: async () =>
      jsonResult({
        count: roots.length,
        roots: roots.map((r) => ({ name: r.name })),
      }),
  }) as const;
