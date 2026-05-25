import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type EngineName = "text" | "bm25" | "semantic";
export type TransportName = "stdio" | "http";

export interface SourceRoot {
  /** Logical name (matches the doc-id prefix when docs were loaded multi-repo). */
  name: string;
  /** Absolute path to the repo root on disk. */
  path: string;
}

export interface ServerConfig {
  /** Absolute path to the agent-docs directory the server will read. */
  docsDir: string;
  /** Absolute path to the prompt directory the server will expose as MCP prompts. */
  promptsDir: string;
  /** Default search engine used when a tool call doesn't specify one. */
  defaultEngine: EngineName;
  /** Transport to use: "stdio" (default) or "http" (Streamable HTTP). */
  transport: TransportName;
  /** Port to listen on when transport is "http". */
  port: number;
  /** Source-code roots the `read_source_file` tool is allowed to read from. */
  sourceRoots: readonly SourceRoot[];
}

const ENGINES = ["text", "bm25", "semantic"] as const satisfies readonly EngineName[];
const TRANSPORTS = ["stdio", "http"] as const satisfies readonly TransportName[];

const isEngine = (value: string): value is EngineName =>
  (ENGINES as readonly string[]).includes(value);

const isTransport = (value: string): value is TransportName =>
  (TRANSPORTS as readonly string[]).includes(value);

const packageRoot = (): string => path.resolve(import.meta.dirname, "..");

/** Collects all values for a repeatable flag (e.g. --repo a --repo b). */
function collectFlag(argv: readonly string[], flag: string): string[] {
  const target = `--${flag}`;
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== target) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.push(next);
      i++;
    }
  }
  return values;
}

/** Gets a single flag value from argv. */
function getFlag(argv: readonly string[], flag: string): string | undefined {
  const target = `--${flag}`;
  for (const [i, value] of argv.entries()) {
    if (value !== target) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) return next;
  }
  return undefined;
}

/**
 * Builds config from CLI flags and environment variables.
 *
 * Recognized flags:
 *   --docs <path>        Explicit agent-docs directory. Overrides the default.
 *   --engine <name>      Default search engine. Also CONTEXT_ENGINE. Defaults to "bm25".
 *   --transport <name>   Transport to use (stdio|http). Also CONTEXT_TRANSPORT. Defaults to "stdio".
 *   --port <number>      Port for HTTP transport. Also CONTEXT_PORT. Defaults to 3050.
 *
 * Default docsDir resolution order:
 *   1. --docs flag or AGENT_DOCS_DIR env var (explicit override)
 *   2. .cache/ctx/ inside the package root (populated by `pnpm ctx:load`)
 */
export function parseConfig(
  argv: readonly string[] = process.argv.slice(2),
): ServerConfig {
  const pkgRoot = packageRoot();
  const promptsDir = path.resolve(import.meta.dirname, "..", "prompts");

  const docsFlag = getFlag(argv, "docs");
  const docsEnv = process.env.AGENT_DOCS_DIR;
  const docsDir = docsFlag
    ? path.resolve(docsFlag)
    : docsEnv
      ? path.resolve(docsEnv)
      : path.join(pkgRoot, ".cache");

  const engineRaw =
    getFlag(argv, "engine") ?? process.env.CONTEXT_ENGINE ?? "bm25";
  if (!isEngine(engineRaw)) {
    throw new Error(
      `Invalid engine "${engineRaw}". Expected one of: ${ENGINES.join(", ")}.`,
    );
  }

  const transportRaw =
    getFlag(argv, "transport") ?? process.env.CONTEXT_TRANSPORT ?? "stdio";
  if (!isTransport(transportRaw)) {
    throw new Error(
      `Invalid transport "${transportRaw}". Expected one of: ${TRANSPORTS.join(", ")}.`,
    );
  }

  const portRaw = getFlag(argv, "port") ?? process.env.CONTEXT_PORT ?? "3050";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port "${portRaw}". Expected an integer 1–65535.`);
  }

  // Source roots (for read_source_file). Three sources, first non-empty wins
  // *per repo name*: explicit CLI flag, env var, then auto-discovery from
  // `source_root:` written into each cached repo's index.yaml by context:load.
  const flagRoots = collectFlag(argv, "source-root");
  const envRoots =
    process.env.AGENT_SOURCE_ROOTS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];

  const sourceRoots: SourceRoot[] = [];
  const seenNames = new Set<string>();

  for (const raw of [...flagRoots, ...envRoots]) {
    const abs = path.resolve(raw);
    if (!existsSync(abs)) {
      throw new Error(`--source-root path does not exist: ${abs}`);
    }
    const name = path.basename(abs);
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    sourceRoots.push({ name, path: abs });
  }

  for (const root of discoverManifestSourceRoots(docsDir)) {
    if (seenNames.has(root.name)) continue;
    seenNames.add(root.name);
    sourceRoots.push(root);
  }

  return {
    docsDir,
    promptsDir,
    defaultEngine: engineRaw,
    transport: transportRaw,
    port,
    sourceRoots,
  };
}

/**
 * Discovers source roots from the docs directory so `read_source_file` works
 * automatically after `context:load` — no `--source-root` flag needed.
 *
 * Checks two formats (newest first, falls back to the older one):
 *   1. Top-level `index.yaml` with a `source_roots:` map — written by the
 *      merged single-manifest approach. Keys are repo names; values are paths.
 *   2. Per-subdirectory `index.yaml` files each with a `source_root:` string —
 *      the legacy layout kept for backward compatibility.
 *
 * Silently skips missing paths and parse failures; this is best-effort.
 */
function discoverManifestSourceRoots(docsDir: string): SourceRoot[] {
  if (!existsSync(docsDir)) return [];

  // 1. Top-level merged manifest with source_roots map.
  for (const name of ["index.yaml", "index.yml", "ctx.yaml"]) {
    const manifestPath = path.join(docsDir, name);
    if (!existsSync(manifestPath)) continue;

    let parsed: unknown;
    try {
      parsed = YAML.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      break;
    }
    if (!parsed || typeof parsed !== "object") break;

    const sourceRootsRaw = (parsed as Record<string, unknown>).source_roots;
    if (
      sourceRootsRaw &&
      typeof sourceRootsRaw === "object" &&
      !Array.isArray(sourceRootsRaw)
    ) {
      const result: SourceRoot[] = [];
      for (const [repoName, rootPath] of Object.entries(
        sourceRootsRaw as Record<string, unknown>,
      )) {
        if (typeof rootPath !== "string" || rootPath.length === 0) continue;
        const abs = path.isAbsolute(rootPath)
          ? rootPath
          : path.resolve(docsDir, rootPath);
        if (!existsSync(abs)) continue;
        result.push({ name: repoName, path: abs });
      }
      return result;
    }
    break;
  }

  // 2. Legacy per-subdirectory manifests with source_root string.
  let entries: string[];
  try {
    entries = readdirSync(docsDir);
  } catch {
    return [];
  }

  const result: SourceRoot[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const subDir = path.join(docsDir, entry);
    try {
      if (!statSync(subDir).isDirectory()) continue;
    } catch {
      continue;
    }

    for (const name of ["ctx.yaml"]) {
      const manifestPath = path.join(subDir, name);
      if (!existsSync(manifestPath)) continue;

      let parsed: unknown;
      try {
        parsed = YAML.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        break;
      }
      if (!parsed || typeof parsed !== "object") break;

      const sourceRoot = (parsed as Record<string, unknown>).source_root;
      if (typeof sourceRoot !== "string" || sourceRoot.length === 0) break;
      if (!existsSync(sourceRoot)) break;

      result.push({ name: path.basename(sourceRoot), path: sourceRoot });
      break;
    }
  }
  return result;
}
