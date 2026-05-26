import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCollectPrompts } from "../src/prompts/collect.js";
import { PROMPTS_DIR } from "./helpers.js";

describe("loadCollectPrompts (built-in prompts)", () => {
  it("loads every numbered prompt from the prompts directory", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);

    const names = prompts.map((p) => p.name);
    expect(names).toContain("00-orientation");
    expect(names).toContain("01-architecture");
    expect(names).toContain("02-modules");
    expect(names).toContain("03-data-flows");
    expect(names).toContain("04-apis");
    expect(names).toContain("05-runtime-behavior");
    expect(names).toContain("06-glossary");
  });

  it("skips README.md", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    const names = prompts.map((p) => p.name.toLowerCase());
    expect(names).not.toContain("readme");
  });

  it("uses the frontmatter description (or first H1) as the description", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    const orientation = prompts.find((p) => p.name === "00-orientation");
    expect(orientation).toBeDefined();
    if (!orientation) return;
    expect(orientation.description.length).toBeGreaterThan(0);
    // body should NOT start with the H1 line (it's stripped during loading)
    expect(orientation.body.startsWith("# ")).toBe(false);
  });

  it("does not declare REPO or DOCS args — prompts target the open project", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    for (const p of prompts) {
      const argNames = p.args.map((a) => a.name);
      expect(argNames, `prompt ${p.name} should not declare REPO`).not.toContain("REPO");
      expect(argNames, `prompt ${p.name} should not declare DOCS`).not.toContain("DOCS");
    }
  });

  it("references agent-docs/ as the output directory in every prompt body", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    for (const p of prompts) {
      expect(p.body, `prompt ${p.name} should write under agent-docs/`).toContain(
        "agent-docs/",
      );
    }
  });

  it("instructs every phase prompt to emit a code_refs: block for read_source_file", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    // Skip the orchestrator — it drives the phase prompts and doesn't itself
    // emit a doc, so it doesn't carry a literal `code_refs:` YAML block.
    const phasePrompts = prompts.filter((p) => p.name !== "initialize-docs");
    for (const p of phasePrompts) {
      expect(p.body, `prompt ${p.name} should mention code_refs:`).toContain(
        "code_refs:",
      );
      expect(
        p.body,
        `prompt ${p.name} should reference read_source_file`,
      ).toContain("read_source_file");
    }
  });

  it("declares per-prompt extras with required: true", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    const modules = prompts.find((p) => p.name === "02-modules");
    expect(modules).toBeDefined();
    if (!modules) return;
    const byName = new Map(modules.args.map((a) => [a.name, a]));
    expect(byName.get("MODULE_NAME")?.required).toBe(true);
    expect(byName.get("MODULE_PATH")?.required).toBe(true);

    const flows = prompts.find((p) => p.name === "03-data-flows");
    expect(flows).toBeDefined();
    const flowsByName = new Map(flows!.args.map((a) => [a.name, a]));
    expect(flowsByName.get("FLOW_NAME")?.required).toBe(true);
    expect(flowsByName.get("ENTRYPOINT")?.required).toBe(true);

    const apis = prompts.find((p) => p.name === "04-apis");
    expect(apis).toBeDefined();
    const apisByName = new Map(apis!.args.map((a) => [a.name, a]));
    expect(apisByName.get("API_NAME")?.required).toBe(true);
    expect(apisByName.get("API_KIND")?.required).toBe(true);
  });

  it("rendered output of 01-architecture inlines the architecture frontmatter scaffold", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    const arch = prompts.find((p) => p.name === "01-architecture");
    expect(arch).toBeDefined();
    if (!arch) return;
    const out = arch.render({});
    expect(out).toContain("id: architecture");
    expect(out).toContain("kind: architecture");
    expect(out).toContain("flowchart LR");
    expect(out).toContain("agent-docs/architecture.md");
  });

  it("parses relation and path on each source entry", async () => {
    const prompts = await loadCollectPrompts(PROMPTS_DIR);
    const orientation = prompts.find((p) => p.name === "00-orientation");
    expect(orientation).toBeDefined();
    if (!orientation) return;
    expect(orientation.sources.length).toBeGreaterThan(0);
    for (const s of orientation.sources) {
      expect(s.relation, `source ${s.id} should declare a relation`).toBeDefined();
      expect(s.path, `source ${s.id} should declare a path`).toBeDefined();
    }
    const architecture = orientation.sources.find((s) => s.id === "architecture");
    expect(architecture?.relation).toBe("drilldown");
    expect(architecture?.path).toBe("architecture.md");
  });
});

describe("loadCollectPrompts (synthetic prompts in a temp dir)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "collect-prompts-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("auto-detects $VAR and ${VAR} tokens in the body", async () => {
    await writeFile(
      path.join(dir, "demo.md"),
      "# Demo\n\nBody references $FOO and ${BAR}.",
    );
    const [prompt] = await loadCollectPrompts(dir);
    expect(prompt).toBeDefined();
    if (!prompt) return;
    const argNames = prompt.args.map((a) => a.name).sort();
    expect(argNames).toEqual(["BAR", "FOO"]);
    for (const a of prompt.args) {
      expect(a.required).toBe(false);
    }
  });

  it("frontmatter args override required and description for matching auto-detected vars", async () => {
    await writeFile(
      path.join(dir, "demo.md"),
      [
        "---",
        "args:",
        "  FOO:",
        "    description: \"Foo input.\"",
        "    required: true",
        "---",
        "",
        "# Demo",
        "",
        "Body references $FOO and $BAR.",
      ].join("\n"),
    );
    const [prompt] = await loadCollectPrompts(dir);
    expect(prompt).toBeDefined();
    if (!prompt) return;
    const byName = new Map(prompt.args.map((a) => [a.name, a]));
    expect(byName.get("FOO")?.required).toBe(true);
    expect(byName.get("FOO")?.description).toBe("Foo input.");
    expect(byName.get("BAR")?.required).toBe(false);
  });

  it("frontmatter-only args are still registered even if the body doesn't reference them", async () => {
    await writeFile(
      path.join(dir, "demo.md"),
      [
        "---",
        "args:",
        "  EXTRA:",
        "    description: \"Future use.\"",
        "    required: false",
        "---",
        "",
        "# Demo",
        "",
        "Body has no vars.",
      ].join("\n"),
    );
    const [prompt] = await loadCollectPrompts(dir);
    expect(prompt).toBeDefined();
    if (!prompt) return;
    const argNames = prompt.args.map((a) => a.name);
    expect(argNames).toContain("EXTRA");
  });

  it("substitutes both $VAR and ${VAR} forms with the provided value", async () => {
    await writeFile(
      path.join(dir, "demo.md"),
      "# Demo\n\nWrite to $DOCS/things/${THING}.md from $REPO.",
    );
    const [prompt] = await loadCollectPrompts(dir);
    expect(prompt).toBeDefined();
    if (!prompt) return;
    const out = prompt.render({ REPO: "/r", DOCS: "/d", THING: "auth" });
    expect(out).toContain("Write to /d/things/auth.md from /r.");
  });

  it("leaves unresolved tokens in place when a value is missing", async () => {
    await writeFile(
      path.join(dir, "demo.md"),
      "# Demo\n\n$REPO and $MISSING.",
    );
    const [prompt] = await loadCollectPrompts(dir);
    expect(prompt).toBeDefined();
    if (!prompt) return;
    const out = prompt.render({ REPO: "/r" });
    expect(out).toContain("/r and $MISSING.");
  });

  it("ignores unknown relation values on a source entry", async () => {
    await writeFile(
      path.join(dir, "demo.md"),
      [
        "---",
        "sources:",
        "  - id: foo",
        "    relation: wat",
        "    path: foo.md",
        "    description: \"x\"",
        "  - id: bar",
        "    relation: drilldown",
        "    description: \"y\"",
        "---",
        "",
        "# Demo",
        "",
        "Body.",
      ].join("\n"),
    );
    const [prompt] = await loadCollectPrompts(dir);
    expect(prompt).toBeDefined();
    if (!prompt) return;
    const foo = prompt.sources.find((s) => s.id === "foo");
    const bar = prompt.sources.find((s) => s.id === "bar");
    expect(foo?.relation).toBeUndefined();
    expect(foo?.path).toBe("foo.md");
    expect(bar?.relation).toBe("drilldown");
    expect(bar?.path).toBeUndefined();
  });

  it("DOCS default of $REPO/agent-docs strips a trailing slash from REPO", async () => {
    await writeFile(
      path.join(dir, "demo.md"),
      "# Demo\n\nWriting to $DOCS.",
    );
    const [prompt] = await loadCollectPrompts(dir);
    expect(prompt).toBeDefined();
    if (!prompt) return;
    const out = prompt.render({ REPO: "/abs/repo/" });
    expect(out).toContain("Writing to /abs/repo/agent-docs.");
  });
});
