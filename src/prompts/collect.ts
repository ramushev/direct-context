import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

export interface PromptArg {
  name: string;
  description: string;
  required: boolean;
}

export const SOURCE_RELATIONS = [
  "prerequisite",
  "drilldown",
  "companion",
  "see-also",
] as const;
export type SourceRelation = (typeof SOURCE_RELATIONS)[number];

const RELATION_SET: ReadonlySet<string> = new Set(SOURCE_RELATIONS);

const isSourceRelation = (value: unknown): value is SourceRelation =>
  typeof value === "string" && RELATION_SET.has(value);

export interface PromptSource {
  id: string;
  description: string;
  /** Semantic relationship from this prompt to the referenced one. */
  relation?: SourceRelation;
  /** Where the referenced doc lives, relative to `agent-docs/`. */
  path?: string;
}

export interface CollectPrompt {
  /** MCP prompt name, e.g. "00-orientation". */
  name: string;
  /** First H1 of the file (or frontmatter `description`/`title`), used as the description. */
  description: string;
  /** Markdown body without frontmatter (with leading H1 stripped). */
  body: string;
  /** Absolute path of the prompt file. */
  absPath: string;
  /** Declared and auto-detected arguments. */
  args: PromptArg[];
  /** Related prompt IDs to consult for more detail. */
  sources: readonly PromptSource[];
  /** Substitutes `$VAR` / `${VAR}` tokens in the body. DOCS defaults to `$REPO/agent-docs`. */
  render(values: Record<string, string>): string;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

function inferTitleFromBody(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim();
  }
  return "";
}

function stripLeadingH1(body: string): string {
  const lines = body.split("\n");
  for (const [i, raw] of lines.entries()) {
    const line = raw ?? "";
    if (line.startsWith("# ")) {
      return lines.slice(i + 1).join("\n").replace(/^\n+/, "");
    }
    if (line.trim().length > 0) break;
  }
  return body;
}

const VAR_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g;

function detectVars(body: string): Set<string> {
  const vars = new Set<string>();
  for (const match of body.matchAll(VAR_PATTERN)) {
    vars.add(match[1] ?? match[2]!);
  }
  return vars;
}

function parsePromptSources(data: Record<string, unknown>): PromptSource[] {
  if (!Array.isArray(data.sources)) return [];
  const result: PromptSource[] = [];
  for (const item of data.sources) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const d = item as Record<string, unknown>;
    if (typeof d.id !== "string") continue;
    const entry: PromptSource = {
      id: d.id,
      description: typeof d.description === "string" ? d.description : "",
    };
    if (isSourceRelation(d.relation)) entry.relation = d.relation;
    if (typeof d.path === "string" && d.path.length > 0) entry.path = d.path;
    result.push(entry);
  }
  return result;
}

interface FrontmatterArgDef {
  description?: string;
  required?: boolean;
}

function parseFrontmatterArgs(
  data: Record<string, unknown>,
): Map<string, FrontmatterArgDef> {
  const result = new Map<string, FrontmatterArgDef>();
  const raw = data.args;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;

  for (const [name, def] of Object.entries(raw as Record<string, unknown>)) {
    const entry: FrontmatterArgDef = {};
    if (def && typeof def === "object" && !Array.isArray(def)) {
      const d = def as Record<string, unknown>;
      if (typeof d.description === "string") entry.description = d.description;
      if (typeof d.required === "boolean") entry.required = d.required;
    }
    result.set(name, entry);
  }
  return result;
}

function buildArgs(
  autoDetected: Set<string>,
  frontmatterArgs: Map<string, FrontmatterArgDef>,
): PromptArg[] {
  const merged = new Map<string, PromptArg>();

  for (const name of autoDetected) {
    merged.set(name, { name, description: "", required: false });
  }

  for (const [name, def] of frontmatterArgs) {
    const existing = merged.get(name);
    merged.set(name, {
      name,
      description: def.description ?? existing?.description ?? "",
      required: def.required ?? existing?.required ?? false,
    });
  }

  return Array.from(merged.values()).toSorted((a, b) =>
    a.name.localeCompare(b.name),
  );
}

const makeRender =
  (body: string) =>
  (values: Record<string, string>): string => {
    const resolved = { ...values };

    if (!("DOCS" in resolved) && "REPO" in resolved) {
      resolved.DOCS = resolved.REPO!.replace(/\/$/, "") + "/agent-docs";
    }

    return body.replace(VAR_PATTERN, (match, braced: string, bare: string) => {
      const name = braced ?? bare;
      return name in resolved ? resolved[name]! : match;
    });
  };

/**
 * Discovers every `*.md` file in `dir` (non-recursive) and returns one
 * `CollectPrompt` per file. Files starting with `_` or `README` are skipped.
 *
 * Each prompt's `$VAR` / `${VAR}` tokens are auto-detected from the body.
 * Frontmatter `args` can override `required` and `description` for those vars,
 * or declare additional args the body doesn't reference.
 */
export async function loadCollectPrompts(dir: string): Promise<CollectPrompt[]> {
  if (!(await dirExists(dir))) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const prompts: CollectPrompt[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith(".md")) continue;
    if (lower === "readme.md" || lower.startsWith("_")) continue;

    const absPath = path.join(dir, entry.name);
    const raw = await readFile(absPath, "utf8");
    const parsed = matter(raw);
    const data = (parsed.data ?? {}) as Record<string, unknown>;

    const fmTitle = typeof data.title === "string" ? data.title : "";
    const fmDescription =
      typeof data.description === "string" ? data.description : "";
    const inferredTitle = inferTitleFromBody(parsed.content);
    const description =
      fmDescription ||
      fmTitle ||
      inferredTitle ||
      entry.name.replace(/\.md$/i, "");

    const body = stripLeadingH1(parsed.content).trim();
    const name = entry.name.replace(/\.md$/i, "");

    prompts.push({
      name,
      description,
      body,
      absPath,
      args: buildArgs(detectVars(body), parseFrontmatterArgs(data)),
      sources: parsePromptSources(data),
      render: makeRender(body),
    });
  }

  return prompts.toSorted((a, b) => a.name.localeCompare(b.name));
}
