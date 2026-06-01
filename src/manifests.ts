import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

import type { CodeRef } from "./loader.js";

/**
 * Polyglot project-manifest detection for synthetic mode.
 *
 * Synthetic mode (`synthetic.ts`) synthesizes structure docs for repos without
 * committed `agent-docs/`. The richest signal — name, description, dependencies,
 * entry points, build/test commands — lives in each ecosystem's manifest. This
 * module reads every manifest it recognizes (a repo can be polyglot) and
 * normalizes them to one `ProjectManifest` shape the doc builders consume,
 * regardless of language.
 *
 * Every parser is **pure** (`(body, relPath) => ProjectManifest | null`) so it
 * unit-tests without disk I/O. Parsing is best-effort: TOML/JSON are parsed
 * properly; XML and language-DSL manifests (gradle, gemspec, setup.py) are
 * regex-scraped for the handful of fields we surface — good enough for metadata,
 * never throwing on the messy real-world cases.
 */

export type Ecosystem =
  | "node"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "ruby"
  | "php"
  | "dotnet";

export interface ProjectManifest {
  /** Source ecosystem, used to label merged sections in the synthesized docs. */
  ecosystem: Ecosystem;
  /** Repo-relative path of the manifest, e.g. `pyproject.toml`. */
  manifestFile: string;
  name?: string;
  version?: string;
  description?: string;
  /** Generalizes package.json `main`/`bin` — runnable/importable entry files. */
  entryPoints: CodeRef[];
  /** Named commands (npm scripts, composer scripts, console entry points). */
  scripts: Array<{ name: string; command: string }>;
  runtimeDeps: string[];
  devDeps: string[];
  /** Detected test runner (vitest, pytest, …) when identifiable. */
  testRunner?: string;
  /** Ecosystem-default build/test hints for manifests without named scripts. */
  buildCommands: Array<{ label: string; command: string }>;
}

/**
 * Priority order when several manifests are present — drives which one's
 * name/description wins as the repo's primary title. Earlier = higher priority.
 */
export const ECOSYSTEM_PRIORITY: readonly Ecosystem[] = [
  "node",
  "python",
  "rust",
  "go",
  "java",
  "ruby",
  "php",
  "dotnet",
];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Keys of a record-valued field, e.g. a `{ dep: version }` dependency table. */
const recordKeys = (v: unknown): string[] => (isRecord(v) ? Object.keys(v) : []);

/** De-dupes while preserving first-seen order. */
const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];

/** Trims a Python/Ruby requirement spec down to its bare package name. */
const bareDepName = (spec: string): string =>
  spec.trim().split(/[\s<>=!~;,(\[]/)[0]?.trim() ?? "";

const PY_TEST_RUNNERS = ["pytest", "tox", "nose2", "nose"];

/** First matching known test runner among a set of dependency names. */
const findTestRunner = (
  deps: readonly string[],
  candidates: readonly string[],
): string | undefined =>
  candidates.find((c) => deps.some((d) => d.toLowerCase() === c));

// ---------------------------------------------------------------------------
// JSON manifests — package.json, composer.json
// ---------------------------------------------------------------------------

const NODE_TEST_RUNNERS = [
  "vitest",
  "jest",
  "mocha",
  "ava",
  "playwright",
  "cypress",
];

function parsePackageJson(body: string, rel: string): ProjectManifest | null {
  let pkg: unknown;
  try {
    pkg = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(pkg)) return null;

  const entryPoints: CodeRef[] = [];
  if (asString(pkg.main)) entryPoints.push({ path: pkg.main as string, description: "main" });
  if (typeof pkg.bin === "string") {
    entryPoints.push({ path: pkg.bin, description: "bin" });
  } else if (isRecord(pkg.bin)) {
    for (const [name, p] of Object.entries(pkg.bin)) {
      if (asString(p)) entryPoints.push({ path: p as string, description: `bin: ${name}` });
    }
  }

  const scripts = isRecord(pkg.scripts)
    ? Object.entries(pkg.scripts)
        .filter(([, c]) => asString(c))
        .map(([name, c]) => ({ name, command: c as string }))
    : [];

  const devDeps = recordKeys(pkg.devDependencies);

  return {
    ecosystem: "node",
    manifestFile: rel,
    name: asString(pkg.name),
    version: asString(pkg.version),
    description: asString(pkg.description),
    entryPoints,
    scripts,
    runtimeDeps: recordKeys(pkg.dependencies),
    devDeps,
    testRunner: findTestRunner(devDeps, NODE_TEST_RUNNERS),
    buildCommands: [],
  };
}

function parseComposerJson(body: string, rel: string): ProjectManifest | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;

  const entryPoints: CodeRef[] = [];
  if (typeof json.bin === "string") {
    entryPoints.push({ path: json.bin, description: "bin" });
  } else if (Array.isArray(json.bin)) {
    for (const p of json.bin) {
      if (asString(p)) entryPoints.push({ path: p as string, description: "bin" });
    }
  }

  const scripts = isRecord(json.scripts)
    ? Object.entries(json.scripts).map(([name, c]) => ({
        name,
        command: Array.isArray(c) ? c.filter(asString).join(" && ") : String(c),
      }))
    : [];

  const devDeps = recordKeys(json["require-dev"]);

  return {
    ecosystem: "php",
    manifestFile: rel,
    name: asString(json.name),
    version: asString(json.version),
    description: asString(json.description),
    entryPoints,
    scripts,
    runtimeDeps: recordKeys(json.require).filter((d) => d !== "php" && !d.startsWith("ext-")),
    devDeps,
    testRunner: devDeps.some((d) => d.includes("phpunit")) ? "phpunit" : undefined,
    buildCommands: [{ label: "install", command: "composer install" }],
  };
}

// ---------------------------------------------------------------------------
// TOML manifests — pyproject.toml, Cargo.toml
// ---------------------------------------------------------------------------

function parsePyproject(body: string, rel: string): ProjectManifest | null {
  let data: Record<string, unknown>;
  try {
    data = parseToml(body) as Record<string, unknown>;
  } catch {
    return null;
  }

  const runtimeDeps: string[] = [];
  const devDeps: string[] = [];
  const scripts: ProjectManifest["scripts"] = [];
  let name: string | undefined;
  let version: string | undefined;
  let description: string | undefined;

  // PEP 621 — [project]
  const project = isRecord(data.project) ? data.project : undefined;
  if (project) {
    name = asString(project.name);
    version = asString(project.version);
    description = asString(project.description);
    if (Array.isArray(project.dependencies)) {
      for (const d of project.dependencies)
        if (typeof d === "string") runtimeDeps.push(bareDepName(d));
    }
    if (isRecord(project["optional-dependencies"])) {
      for (const arr of Object.values(project["optional-dependencies"])) {
        if (Array.isArray(arr))
          for (const d of arr) if (typeof d === "string") devDeps.push(bareDepName(d));
      }
    }
    for (const key of ["scripts", "gui-scripts"]) {
      if (isRecord(project[key])) {
        for (const [n, target] of Object.entries(project[key] as Record<string, unknown>))
          if (asString(target)) scripts.push({ name: n, command: target as string });
      }
    }
  }

  // Poetry — [tool.poetry]
  const tool = isRecord(data.tool) ? data.tool : undefined;
  const poetry = tool && isRecord(tool.poetry) ? tool.poetry : undefined;
  if (poetry) {
    name ??= asString(poetry.name);
    version ??= asString(poetry.version);
    description ??= asString(poetry.description);
    for (const d of recordKeys(poetry.dependencies)) if (d !== "python") runtimeDeps.push(d);
    for (const d of recordKeys(poetry["dev-dependencies"])) devDeps.push(d);
    const group = isRecord(poetry.group) ? poetry.group : undefined;
    if (group) {
      for (const g of Object.values(group)) {
        if (isRecord(g)) for (const d of recordKeys(g.dependencies)) devDeps.push(d);
      }
    }
    if (isRecord(poetry.scripts)) {
      for (const [n, target] of Object.entries(poetry.scripts))
        if (asString(target)) scripts.push({ name: n, command: target as string });
    }
  }

  const allDeps = [...runtimeDeps, ...devDeps];
  const testRunner = findTestRunner(allDeps, PY_TEST_RUNNERS);

  return {
    ecosystem: "python",
    manifestFile: rel,
    name,
    version,
    description,
    entryPoints: [],
    scripts,
    runtimeDeps: uniq(runtimeDeps),
    devDeps: uniq(devDeps),
    testRunner,
    buildCommands: pythonBuildCommands(testRunner, "pip install -e ."),
  };
}

function pythonBuildCommands(
  testRunner: string | undefined,
  install: string,
): ProjectManifest["buildCommands"] {
  const cmds = [{ label: "install", command: install }];
  if (testRunner === "tox") cmds.push({ label: "test", command: "tox" });
  else if (testRunner) cmds.push({ label: "test", command: "pytest" });
  return cmds;
}

function parseCargoToml(body: string, rel: string): ProjectManifest | null {
  let data: Record<string, unknown>;
  try {
    data = parseToml(body) as Record<string, unknown>;
  } catch {
    return null;
  }

  const pkg = isRecord(data.package) ? data.package : undefined;
  const entryPoints: CodeRef[] = [];
  if (Array.isArray(data.bin)) {
    for (const b of data.bin) {
      if (isRecord(b) && asString(b.path))
        entryPoints.push({ path: b.path as string, description: `bin: ${asString(b.name) ?? ""}`.trim() });
    }
  }

  return {
    ecosystem: "rust",
    manifestFile: rel,
    name: pkg ? asString(pkg.name) : undefined,
    version: pkg ? asString(pkg.version) : undefined,
    description: pkg ? asString(pkg.description) : undefined,
    entryPoints,
    scripts: [],
    runtimeDeps: recordKeys(data.dependencies),
    devDeps: recordKeys(data["dev-dependencies"]),
    buildCommands: [
      { label: "build", command: "cargo build" },
      { label: "test", command: "cargo test" },
    ],
  };
}

// ---------------------------------------------------------------------------
// INI manifest — setup.cfg
// ---------------------------------------------------------------------------

function parseSetupCfg(body: string, rel: string): ProjectManifest | null {
  const sections = new Map<string, Map<string, string[]>>();
  let section = "";
  let lastKey = "";
  for (const raw of body.split("\n")) {
    const line = raw.replace(/[#;].*$/, "").replace(/\s+$/, "");
    if (!line.trim()) continue;
    const sec = line.match(/^\[([^\]]+)\]\s*$/);
    if (sec) {
      section = sec[1]!.trim();
      if (!sections.has(section)) sections.set(section, new Map());
      lastKey = "";
      continue;
    }
    const kv = line.match(/^(\w[\w.-]*)\s*=\s*(.*)$/);
    const bucket = sections.get(section) ?? new Map();
    sections.set(section, bucket);
    if (kv) {
      lastKey = kv[1]!;
      bucket.set(lastKey, kv[2]!.trim() ? [kv[2]!.trim()] : []);
    } else if (lastKey && /^\s/.test(raw)) {
      bucket.get(lastKey)?.push(line.trim()); // continuation line
    }
  }

  const meta = sections.get("metadata");
  const options = sections.get("options");
  if (!meta && !options) return null;

  const runtimeDeps = (options?.get("install_requires") ?? []).map(bareDepName).filter(Boolean);

  return {
    ecosystem: "python",
    manifestFile: rel,
    name: meta?.get("name")?.[0],
    version: meta?.get("version")?.[0],
    description: meta?.get("description")?.[0],
    entryPoints: [],
    scripts: [],
    runtimeDeps: uniq(runtimeDeps),
    devDeps: [],
    testRunner: findTestRunner(runtimeDeps, PY_TEST_RUNNERS),
    buildCommands: [{ label: "install", command: "pip install -e ." }],
  };
}

// ---------------------------------------------------------------------------
// Regex / line-format manifests
// ---------------------------------------------------------------------------

function parseSetupPy(body: string, rel: string): ProjectManifest | null {
  const field = (key: string): string | undefined =>
    body.match(new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`))?.[1];

  const requires: string[] = [];
  const block = body.match(/install_requires\s*=\s*\[([\s\S]*?)\]/);
  if (block) {
    for (const m of block[1]!.matchAll(/["']([^"']+)["']/g)) requires.push(bareDepName(m[1]!));
  }

  const name = field("name");
  if (!name && requires.length === 0) return null;

  return {
    ecosystem: "python",
    manifestFile: rel,
    name,
    version: field("version"),
    description: field("description"),
    entryPoints: [],
    scripts: [],
    runtimeDeps: uniq(requires),
    devDeps: [],
    testRunner: findTestRunner(requires, PY_TEST_RUNNERS),
    buildCommands: [{ label: "install", command: "pip install -e ." }],
  };
}

function parseRequirements(body: string, rel: string): ProjectManifest | null {
  const deps: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line || line.startsWith("-")) continue; // skip flags like -r, -e, --hash
    const name = bareDepName(line);
    if (name) deps.push(name);
  }
  if (deps.length === 0) return null;
  return {
    ecosystem: "python",
    manifestFile: rel,
    entryPoints: [],
    scripts: [],
    runtimeDeps: uniq(deps),
    devDeps: [],
    testRunner: findTestRunner(deps, PY_TEST_RUNNERS),
    buildCommands: [{ label: "install", command: `pip install -r ${rel}` }],
  };
}

function parseGoMod(body: string, rel: string): ProjectManifest | null {
  const moduleLine = body.match(/^module\s+(\S+)/m);
  if (!moduleLine) return null;
  const modulePath = moduleLine[1]!;

  const deps: string[] = [];
  let inBlock = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("require (")) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line === ")") inBlock = false;
      else {
        const dep = line.split(/\s+/)[0];
        if (dep && !dep.startsWith("//")) deps.push(dep);
      }
      continue;
    }
    const single = line.match(/^require\s+(\S+)\s+\S+/);
    if (single) deps.push(single[1]!);
  }

  return {
    ecosystem: "go",
    manifestFile: rel,
    name: modulePath.split("/").pop(),
    description: `Go module ${modulePath}`,
    entryPoints: [],
    scripts: [],
    runtimeDeps: uniq(deps),
    devDeps: [],
    buildCommands: [
      { label: "build", command: "go build ./..." },
      { label: "test", command: "go test ./..." },
    ],
  };
}

function parseGemfile(body: string, rel: string): ProjectManifest | null {
  const runtime: string[] = [];
  const dev: string[] = [];
  let depthInDevGroup = 0;

  for (const raw of body.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const group = line.match(/^group\s+(.+?)\s+do\b/);
    if (group) {
      if (/:(development|test)\b/.test(group[1]!)) depthInDevGroup++;
      else depthInDevGroup += 0; // non-dev group: leave flag unchanged
      continue;
    }
    if (line === "end" && depthInDevGroup > 0) {
      depthInDevGroup--;
      continue;
    }
    const gem = line.match(/^gem\s+["']([^"']+)["']/);
    if (gem) (depthInDevGroup > 0 ? dev : runtime).push(gem[1]!);
  }

  if (runtime.length === 0 && dev.length === 0) return null;
  return {
    ecosystem: "ruby",
    manifestFile: rel,
    entryPoints: [],
    scripts: [],
    runtimeDeps: uniq(runtime),
    devDeps: uniq(dev),
    testRunner: [...runtime, ...dev].some((d) => d === "rspec") ? "rspec" : undefined,
    buildCommands: [{ label: "install", command: "bundle install" }],
  };
}

function parseGemspec(body: string, rel: string): ProjectManifest | null {
  const field = (suffix: string): string | undefined =>
    body.match(new RegExp(`\\.${suffix}\\s*=\\s*["']([^"']+)["']`))?.[1];

  const runtime: string[] = [];
  const dev: string[] = [];
  for (const m of body.matchAll(
    /\.add(_runtime|_development)?_dependency\s*\(?\s*["']([^"']+)["']/g,
  )) {
    (m[1] === "_development" ? dev : runtime).push(m[2]!);
  }

  const name = field("name");
  if (!name && runtime.length === 0 && dev.length === 0) return null;
  return {
    ecosystem: "ruby",
    manifestFile: rel,
    name,
    version: field("version"),
    description: field("summary") ?? field("description"),
    entryPoints: [],
    scripts: [],
    runtimeDeps: uniq(runtime),
    devDeps: uniq(dev),
    testRunner: [...runtime, ...dev].some((d) => d === "rspec") ? "rspec" : undefined,
    buildCommands: [{ label: "install", command: "bundle install" }],
  };
}

function parseGradle(body: string, rel: string): ProjectManifest | null {
  const runtime: string[] = [];
  const dev: string[] = [];
  // implementation 'group:artifact:version'  /  testImplementation("g:a:v")
  const re = /(\w*[Ii]mplementation|api|compileOnly|runtimeOnly)\s*[\s(]\s*["']([^"']+:[^"']+)["']/g;
  for (const m of body.matchAll(re)) {
    const artifact = m[2]!.split(":")[1] ?? m[2]!;
    if (/^test/i.test(m[1]!)) dev.push(artifact);
    else runtime.push(artifact);
  }
  if (runtime.length === 0 && dev.length === 0) return null;
  return {
    ecosystem: "java",
    manifestFile: rel,
    entryPoints: [],
    scripts: [],
    runtimeDeps: uniq(runtime),
    devDeps: uniq(dev),
    buildCommands: [
      { label: "build", command: "gradle build" },
      { label: "test", command: "gradle test" },
    ],
  };
}

function parsePomXml(body: string, rel: string): ProjectManifest | null {
  const tag = (name: string): string | undefined =>
    body.match(new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`))?.[1];

  const deps: string[] = [];
  const dev: string[] = [];
  for (const m of body.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const block = m[1]!;
    const artifact = block.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/)?.[1];
    if (!artifact) continue;
    if (/<scope>\s*test\s*<\/scope>/.test(block)) dev.push(artifact);
    else deps.push(artifact);
  }

  // First <artifactId> in the file is the project's own (it precedes <dependencies>).
  const name = body.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/)?.[1];
  if (!name) return null;
  return {
    ecosystem: "java",
    manifestFile: rel,
    name,
    version: tag("version"),
    description: tag("description"),
    entryPoints: [],
    scripts: [],
    runtimeDeps: uniq(deps),
    devDeps: uniq(dev),
    buildCommands: [
      { label: "build", command: "mvn package" },
      { label: "test", command: "mvn test" },
    ],
  };
}

function parseCsproj(body: string, rel: string): ProjectManifest | null {
  const tag = (name: string): string | undefined =>
    body.match(new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`))?.[1];

  const deps: string[] = [];
  for (const m of body.matchAll(/<PackageReference\s+[^>]*Include="([^"]+)"/g))
    deps.push(m[1]!);

  return {
    ecosystem: "dotnet",
    manifestFile: rel,
    name: tag("AssemblyName") ?? tag("RootNamespace") ?? path.basename(rel, ".csproj"),
    version: tag("Version"),
    description: tag("Description"),
    entryPoints: [],
    scripts: [],
    runtimeDeps: uniq(deps),
    devDeps: [],
    buildCommands: [
      { label: "build", command: "dotnet build" },
      { label: "test", command: "dotnet test" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

type Parser = (body: string, rel: string) => ProjectManifest | null;

/** Matches a repo-relative path against a manifest parser. Order matters. */
const REGISTRY: ReadonlyArray<{ match: (base: string) => boolean; parse: Parser }> = [
  { match: (b) => b === "package.json", parse: parsePackageJson },
  { match: (b) => b === "composer.json", parse: parseComposerJson },
  { match: (b) => b === "pyproject.toml", parse: parsePyproject },
  { match: (b) => b === "Cargo.toml", parse: parseCargoToml },
  { match: (b) => b === "setup.cfg", parse: parseSetupCfg },
  { match: (b) => b === "setup.py", parse: parseSetupPy },
  { match: (b) => b === "requirements.txt" || /^requirements[-.].*\.txt$/.test(b), parse: parseRequirements },
  { match: (b) => b === "go.mod", parse: parseGoMod },
  { match: (b) => b === "Gemfile", parse: parseGemfile },
  { match: (b) => b.endsWith(".gemspec"), parse: parseGemspec },
  { match: (b) => b === "build.gradle" || b === "build.gradle.kts", parse: parseGradle },
  { match: (b) => b === "pom.xml", parse: parsePomXml },
  { match: (b) => b.endsWith(".csproj"), parse: parseCsproj },
];

/**
 * Detects and parses every recognized manifest at the repo root. `fileList` is
 * the full checkout listing (so non-indexable manifests like `go.mod` are still
 * seen); manifests are read directly from `checkoutDir`. Root-level only for now
 * — monorepo/nested manifests are a follow-up. Returns one entry per parsed
 * manifest, sorted by ecosystem priority so the primary is first.
 */
export async function detectManifests(
  checkoutDir: string,
  fileList: readonly string[],
): Promise<ProjectManifest[]> {
  const rootFiles = fileList.filter((rel) => !rel.includes("/"));
  const manifests: ProjectManifest[] = [];

  for (const rel of rootFiles) {
    const entry = REGISTRY.find((e) => e.match(rel));
    if (!entry) continue;
    try {
      const body = await readFile(path.join(checkoutDir, rel), "utf8");
      const parsed = entry.parse(body, rel);
      if (parsed) manifests.push(parsed);
    } catch {
      // Unreadable manifest — skip; best-effort detection.
    }
  }

  manifests.sort(
    (a, b) =>
      ECOSYSTEM_PRIORITY.indexOf(a.ecosystem) - ECOSYSTEM_PRIORITY.indexOf(b.ecosystem) ||
      a.manifestFile.localeCompare(b.manifestFile),
  );
  return manifests;
}
