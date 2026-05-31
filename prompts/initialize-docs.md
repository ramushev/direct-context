---
id: initialize-docs
title: "Initialize agent docs (orchestrator)"
kind: meta
description: "One-shot orchestrator that fans out sub-agents to produce the full agent-docs set."
tags: [orchestrator, meta, sub-agents, full-collection]
sources:
  - id: overview
    relation: drilldown
    path: overview.md
    description: "produced by the orientation sub-agent"
  - id: architecture
    relation: drilldown
    path: architecture.md
    description: "produced by the architecture sub-agent; drives wave-4 fan-out"
  - id: modules
    relation: drilldown
    path: modules/
    description: "one sub-agent per module"
  - id: data-flows
    relation: drilldown
    path: flows/
    description: "one sub-agent per flow"
  - id: apis
    relation: drilldown
    path: apis/
    description: "one sub-agent per API surface"
args:
  PARALLEL_SUBAGENTS:
    description: "Max sub-agents to run concurrently in waves 4 and 5 (default: 4)."
    required: false
  SUBAGENT_MODEL:
    description: "Model for wave-4 and wave-5 sub-agents (default: claude-sonnet-4-6). Per-item docs are mechanical once architecture is fixed and don't need the orchestrator's reasoning depth. Wave 1 stays on the orchestrator's model."
    required: false
  SKIP_PHASES:
    description: "Comma-separated prompt IDs to force-skip on top of auto-detected skips (see 'Phase relevance check'). E.g. '10-permissions' to drop authz docs even though authz code exists."
    required: false
  FORCE_PHASES:
    description: "Comma-separated prompt IDs to force-keep despite auto-detection saying skip. E.g. '13-frontend' to produce a stub 'no UI' doc for symmetry across a doc set spanning many repos."
    required: false
---

# Initialize docs (orchestrator)

You are the **orchestrator** agent. Your job is to produce the complete
`agent-docs/` set for the currently open project by delegating each
documentation phase to a dedicated sub-agent — one sub-agent per phase,
and one sub-agent per item inside fan-out phases (modules, flows, APIs).

## Goal

In a single run, produce every doc the 17 individual collect prompts would
produce — orientation, architecture, modules, data-flows, APIs, runtime,
glossary, data-model, business-logic, integrations, permissions, events,
errors, frontend, deployment, testing, observability, coding-patterns — plus
an `AGENTS.md` pointer at the repo root.

## Orchestration model

You **do not** write the doc bodies yourself. For each phase, spawn a
sub-agent with a self-contained briefing and let it produce the output
file. The orchestrator's responsibilities are:

1. **Discovery** — list modules, flows, APIs, integrations to fan out over.
2. **Dispatch** — spawn one sub-agent per phase / per item, with the right
   inputs and a pointer to that phase's prompt.
3. **Assembly** — collect return paths, generate the index, wire up
   cross-doc links, and validate the final output.

Every sub-agent's brief must include:
- The **shared context bundle** (see "Shared context bundle" below) — embedded
  verbatim as the first portion of the brief so prompt caching can hit across
  sibling sub-agents.
- Any per-item variables it needs (`MODULE_NAME`, `FLOW_NAME`, etc.) — placed
  AFTER the bundle.

**Model selection.** Dispatch wave-4 and wave-5 sub-agents on
`$SUBAGENT_MODEL` (default: `claude-sonnet-4-6`). Wave-1 sub-agents
(orientation, architecture, glossary) drive every later decision, so keep them
on the orchestrator's parent model. This alone typically cuts per-item cost
3-5× without quality loss on mechanical per-module / per-flow / per-API docs.

## Source of truth — read code, not prior docs

The input to this run is the **repo's source code**, read directly through the
editor's native filesystem tools. Do **not** ingest previously-generated docs
for the same repo as input — neither the on-disk `agent-docs/` from a past
run nor the same repo's docs served through the `direct-context` MCP server.
Doing so launders stale output back in as input and stops the regeneration
from picking up code changes.

**During docs generation, `get_prompt` is the ONLY direct-context tool that
may be called against the open repo. Every other direct-context tool is
ignored for the duration of this run.**

**Allowed (and required):**

- `get_prompt({ id: "<phase-id>" })` — resolves each phase's authoritative
  spec. Call it **once per kept phase** (after Wave 2's relevance check) and
  embed the returned body inline in the shared bundle (see Wave 3). This is
  the canonical way to fetch phase specs; do not paste prompt files from disk.

**Ignored for this run (do NOT call against the open repo):**

- `search_agent_docs`, `get_agent_doc`, `list_agent_docs` — they return
  whatever was last ingested by `pnpm ctx:load`, by definition older than
  the code you're about to re-describe.
- `read_source_file`, `list_source_dir`, `list_source_roots` — read the code
  with the editor's native file tools (Read / Glob / Grep). They're faster
  and don't go through the MCP sandbox.

These tools are ignored **only during this docs-generation run**. Once the
docs are written, downstream agents working on the code should actively use
them — that is the entire point of the AGENTS.md managed block below.

**Also do not:**

- Pre-read `agent-docs/*.md` from the open repo to "seed" any sub-agent's
  brief. The only docs that enter a sub-agent brief are the wave-1 outputs
  produced **earlier in this same run**.
- Treat any earlier `agent-docs/` content as authoritative. If `agent-docs/`
  already exists in the open repo, it will be overwritten — detecting it is
  useful only for the `AGENTS.md` already-exists check in Assembly.

Calls against a **different** repo (a known dependency or sibling) are fine.
The stale-input problem only applies to the repo currently being regenerated.

## Phase plan

Run in five waves so later sub-agents have prerequisites to link into. Waves
1, 4, and 5 produce documents; waves 2 and 3 are orchestrator-only setup
(relevance pruning and shared-bundle assembly) and emit no docs themselves.

### Wave 1 — foundations (serial)

These three drive everything else. Run them first and wait for completion
before launching wave 2.

| # | Phase         | Prompt ID         | Variables | Output                          |
|---|---------------|-------------------|-----------|---------------------------------|
| 1 | Orientation   | `00-orientation`  | (none)    | `agent-docs/overview.md`        |
| 2 | Architecture  | `01-architecture` | (none)    | `agent-docs/architecture.md`    |
| 3 | Glossary      | `06-glossary`     | (none)    | `agent-docs/glossary.md`        |

### Wave 2 — phase relevance check (orchestrator)

Not every repo needs every doc. Before assembling bundles or dispatching
fan-out, inspect what wave 1 produced and prune phases whose underlying
concept doesn't exist in this repo. Producing "this repo has no frontend"
stub docs across 20 repos is waste — both in cost and in noise for the
agents that later read the doc set.

**Always-run (7 phases, never auto-skipped):**
`00-orientation`, `01-architecture`, `06-glossary`, `02-modules`,
`14-deployment`, `15-testing`, `17-coding-patterns`.

**Conditional (10 phases — auto-skipped if no signal fires):**

| Prompt ID             | Keep if any of these signals present                                                    |
|-----------------------|-----------------------------------------------------------------------------------------|
| `03-data-flows`       | architecture.md lists user-facing entry points, or an API/UI surface exists             |
| `04-apis`             | REST/gRPC/GraphQL/CLI surface in architecture.md, or a `routes/`, `controllers/`, `handlers/`, `api/` dir |
| `05-runtime-behavior` | long-running process: server entrypoint, blocking `main()`, cron/scheduled jobs         |
| `07-data-model`       | DB driver in deps (`pg`, `mysql2`, `sqlite`, `prisma`, `gorm`, `sqlalchemy`, `mongoose`) or a `migrations/` dir |
| `08-business-logic`   | a `domain/`, `services/`, `core/`, or `usecases/` module with >500 LOC of non-plumbing  |
| `09-integrations`     | third-party API clients in deps (cloud SDKs, Stripe, Twilio, OpenAI, Slack, etc.)       |
| `10-permissions`      | auth middleware, an `auth/`/`authz/`/`permissions/`/`rbac/` module, or policy config    |
| `11-events`           | event bus client in deps (`kafka`, `nats`, `sqs`, `eventbridge`, `pubsub`, `rabbitmq`) or an in-process event-emitter pattern |
| `12-errors`           | public error contract: exported error-code enum, `errors.ts`/`errors.go`, structured error types |
| `13-frontend`         | frontend framework in deps (React, Vue, Svelte, Angular, Solid, SwiftUI, Jetpack Compose) |
| `16-observability`    | `prometheus`, `opentelemetry`, `sentry`, `datadog`, `newrelic` in deps, or a dedicated `logger`/`metrics`/`tracing` module |

**Detection procedure:**

1. Read every dependency manifest at the repo root: `package.json`, `go.mod`,
   `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `pom.xml`, `Gemfile`,
   `Podfile`, `pubspec.yaml`. Collect the full dep list.
2. Read `architecture.md`'s component table and entry-points list.
3. Glob the top two directory levels for the named dirs in the signals column.
4. For each conditional phase, mark **keep** if any signal fires, else **skip**.

**Apply overrides:**

1. Start with the auto-detected keep/skip list.
2. Remove from KEEP anything in `$SKIP_PHASES`.
3. Add to KEEP anything in `$FORCE_PHASES` (overrides auto-skip).

**Print the plan before dispatch:**

```
Phase plan for <repo>:
  KEEP (12):  00-orientation, 01-architecture, 02-modules, 04-apis,
              05-runtime-behavior, 06-glossary, 07-data-model,
              08-business-logic, 14-deployment, 15-testing,
              16-observability, 17-coding-patterns
  SKIP (5):   03-data-flows  (auto: no user-facing entry points)
              09-integrations (auto: no third-party SDK deps)
              10-permissions (auto: no auth module)
              11-events      (auto: no event bus client)
              13-frontend    (auto: no UI framework in deps)
```

Each skipped phase must show its reason: `auto: <signal that failed>`,
`$SKIP_PHASES`, or `auto-skipped, kept via $FORCE_PHASES`. This makes the
prune auditable when the user re-runs across many repos.

The skip list also gates wave 4: if `04-apis` is skipped, do not enumerate
API surfaces or spawn per-API sub-agents at all.

### Wave 3 — shared context bundle (orchestrator, one-shot)

Bundle contents, in this exact order:

1. **Wave-1 outputs in full** — `overview.md`, `architecture.md`,
   `glossary.md`. Inline the file bodies, not summaries.
2. **Repo map** — `tree -L 3` of the repo root, language histogram
   (`cloc` or equivalent), and the 20 most-imported internal files. Compute
   this once in the orchestrator so per-item sub-agents skip re-exploration.
3. **Linking rules + frontmatter schema** — copy the "Cross-doc linking"
   section and the frontmatter field list from this prompt verbatim. Same
   bytes in every brief.
4. **Phase spec** — resolve `get_prompt({ id })` once per phase in the
   orchestrator and embed the returned body inline. Do NOT have sub-agents
   call `get_prompt` themselves — that pulls the spec OUT of the cached
   prefix and forces a refetch per sub-agent.

**Cache-friendly briefing structure (mandatory):** the bundle goes FIRST and
the per-item variables (`MODULE_NAME`, output path, etc.) go LAST. Anything
that varies per item must not appear inside the prefix or the cache misses.

Within a single phase, items 1-3 are identical across all sub-agents and
item 4 is identical across all items in that phase — so you pay full price for
the first sub-agent in each phase and hit the cache for the rest.

### Wave 4 — fan-out (parallel, capped by `$PARALLEL_SUBAGENTS`)

From the **component table** in `architecture.md`, derive:

- list of `(MODULE_NAME, MODULE_PATH)` pairs (every component listed)
- 3–5 most important user-facing flows `(FLOW_NAME, ENTRYPOINT)` (from
  the overview's entry-points and any obvious user journeys)
- API surfaces `(API_NAME, API_KIND)` — REST, gRPC, GraphQL, CLI, etc.
- integrations `(INTEGRATION_NAME)` and stores `(STORE_NAME)`

Then spawn one sub-agent per item:

| Phase           | Prompt ID            | One sub-agent per…     | Output path                       |
|-----------------|----------------------|------------------------|-----------------------------------|
| Modules         | `02-modules`         | module                 | `agent-docs/modules/<name>.md`    |
| Data flows      | `03-data-flows`      | flow                   | `agent-docs/flows/<name>.md`      |
| APIs            | `04-apis`            | API surface            | `agent-docs/apis/<name>.md`       |
| Data model      | `07-data-model`      | store (or one for all) | `agent-docs/data-model.md`        |
| Business logic  | `08-business-logic`  | domain area (or one)   | `agent-docs/business-logic.md`    |
| Integrations    | `09-integrations`    | integration (or one)   | `agent-docs/integrations.md`      |

### Wave 5 — system-wide docs (parallel)

No fan-out — one sub-agent per phase.

| Phase            | Prompt ID             | Output path                       |
|------------------|-----------------------|-----------------------------------|
| Runtime behavior | `05-runtime-behavior` | `agent-docs/runtime-behavior.md`  |
| Permissions      | `10-permissions`      | `agent-docs/permissions.md`       |
| Events           | `11-events`           | `agent-docs/events.md`            |
| Errors           | `12-errors`           | `agent-docs/errors.md`            |
| Frontend         | `13-frontend`         | `agent-docs/frontend.md`          |
| Deployment       | `14-deployment`       | `agent-docs/deployment.md`        |
| Testing          | `15-testing`          | `agent-docs/testing.md`           |
| Observability    | `16-observability`    | `agent-docs/observability.md`     |
| Coding patterns  | `17-coding-patterns`  | `agent-docs/coding-patterns.md`   |

## Cross-doc linking

The produced `agent-docs/` set is intended to be opened as an **Obsidian
vault**, so use Obsidian wiki-link syntax for every cross-doc reference:

- Same folder: `[[architecture]]` (no `.md` extension).
- Subfolder: `[[modules/auth]]`, `[[flows/user-signup]]`, `[[apis/rest]]`.
- With display text: `[[architecture|the architecture doc]]`.

Do **not** use standard markdown links (`[text](file.md)`) for cross-doc
references — they break Obsidian backlinks and graph view. Link the first
mention only; don't repeat the link in the same paragraph. External URLs
(GitHub, vendor docs, etc.) keep the regular `[text](https://…)` form.

**Always emit unqualified link targets** (`[[overview]]`, not
`[[my-repo/overview]]`). The collected doc set is valid as a standalone
Obsidian vault for this repo on its own. If it is later combined with
other repos' doc sets into a multi-repo vault, a separate post-processing
step (the consumer's `pnpm vault:build`) qualifies the links to
`[[<repo>/...]]` form to avoid filename collisions across repos.

Every doc ends with a `## Related` section that lists links to each entry
in its frontmatter `sources:`, labeled with the relation:

```
## Related
- prerequisite: [[architecture]]
- companion:    [[business-logic]]
- companion:    [[coding-patterns]]
```

Keep frontmatter (`id`, `title`, `kind`, `tags`, `code_refs`, `sources`)
unchanged. Keep `modules/`, `flows/`, `apis/` folder layout exactly as the
existing prompts dictate.

## Assembly (after every sub-agent returns)

1. **Write or merge `AGENTS.md` at the repo root** — a minimal pointer
   file so any AI agent landing on the repo discovers the generated doc
   set and knows the rules for using and updating it.

   The orchestrator owns three sections: **Where context lives**, **How
   to read it**, and **Keeping docs current**. These three are wrapped
   in HTML-comment sentinels so the orchestrator can rewrite them on
   re-runs without touching user-authored content. Everything outside
   the sentinels is user territory and must be preserved verbatim.

   **Managed block scaffold:**

   ```markdown
   <!-- direct-context:managed:begin -->
   <!-- Generated by initialize-docs. Edit `prompts/initialize-docs.md` to
        change this block, or write your own sections above/below it. -->

   ## Where context lives

   Architecture, modules, flows, APIs, runtime behavior, and conventions
   for this repo are documented under [`agent-docs/`](./agent-docs/).
   Start at [`agent-docs/overview.md`](./agent-docs/overview.md).

   ## How to read it

   **Preferred — `direct-context` MCP server.** If `search_agent_docs`,
   `get_agent_doc`, and `read_source_file` appear in your toolbelt, the
   `direct-context` server is connected and is the canonical source.
   **Actively use these tools** before reading code: they expose the same
   docs plus full-text/semantic search and a sandboxed path from each doc
   back to the source files it cites, and they cost a fraction of a blind
   repo scan. Default to this loop before falling back to grep:

   1. `search_agent_docs({ query })` — find relevant docs. The default
      engine is BM25; pass `engine: "semantic"` for conceptual queries
      ("how are tokens validated").
   2. `get_agent_doc({ id })` — fetch the doc body and its `code_refs[]`
      (a typed list of `{ repo, path, ref?, description? }` pointers).
   3. `read_source_file({ repo, path })` — open the source files the doc
      cites. Pass `code_refs` entries straight through; `repo` and `path`
      are already resolved.

   Also available: `list_agent_docs` (every doc, no search),
   `list_source_dir` (when a `code_ref` points at a directory),
   `list_source_roots` (names of the repos the server can read source from).

   **Exception — the currently-open repo.** The rule above is for the
   *other* repos `direct-context` serves (dependencies, siblings) that
   you don't have checked out. For **this** repo — the one this
   `AGENTS.md` lives in — read its own source and `agent-docs/` directly
   with native file tools. `direct-context` only exposes a
   `pnpm ctx:load` snapshot of it, which lags the working tree, so its
   answers about this repo can be stale. Treat the working tree as
   authoritative for the open repo; use the MCP tools for everything
   you can't see locally.

   **Fallback — read the files directly.** If the MCP tools aren't
   present, open the `*.md` files under `agent-docs/` yourself. The set
   is laid out as an Obsidian vault — `[[wiki-links]]` between docs work
   natively in Obsidian and read as plain references elsewhere. Each
   doc's frontmatter `code_refs:` block lists the source files it cites
   (relative paths from the repo root) — same information `direct-context`
   exposes, just without the search layer.

   ## Keeping docs current

   When you change code that's described in `agent-docs/`, update the
   relevant doc(s) **in the same change**:

   - New / removed module → update `architecture.md` and add/remove
     `modules/<name>.md`
   - New or changed user flow → update `flows/<name>.md`
   - New or changed API surface → update `apis/<name>.md`
   - New env var, deploy step, runtime behavior → update the matching
     system-wide doc (`deployment.md`, `runtime-behavior.md`, etc.)

   Docs and code ship together. If you're unsure which doc owns a topic,
   check each doc's frontmatter `code_refs:` field — every source file
   cited by a doc appears there.
   <!-- direct-context:managed:end -->
   ```

   **Write/merge procedure:**

   - **No `AGENTS.md` exists** → write a new file. Top of the file:

     ```markdown
     # AGENTS.md

     <project name> — <one-line purpose from overview.md>

     ```

     Then the managed block scaffold verbatim. Pull `<project name>` and
     `<one-line purpose>` from `agent-docs/overview.md` (the orientation
     sub-agent's output). Do not add a summary of the repo; the doc set
     itself is the summary.

   - **`AGENTS.md` exists and contains the sentinels**
     (`<!-- direct-context:managed:begin -->` and `<!-- direct-context:managed:end -->`)
     → replace the bytes **between** the markers (inclusive of the
     marker lines themselves) with the freshly-rendered managed block.
     Leave every byte outside the markers untouched, including the
     project name line and any user-written sections.

   - **`AGENTS.md` exists but has no sentinels** → the file is
     hand-authored. Do **not** overwrite it. Append the managed block to
     the end of the file, preceded by a blank line, so user content
     stays at the top:

     ```
     <existing file content, unchanged>

     <managed block scaffold>
     ```

     Report in the final summary which mode was used so the user can
     review the diff.

   Emit the managed block **verbatim** — the "How to read it" tool
   recipe is the contract for downstream agents and must not be
   paraphrased, reordered, or trimmed. The sentinel comment lines are
   load-bearing; without them, re-runs can't find the block to update.

2. **Validate cross-references.** For every `[[wiki-link]]` in every doc,
   verify the target file exists in the vault (resolving `[[name]]` to
   `name.md` and `[[sub/name]]` to `sub/name.md`). Report broken links —
   do not silently strip them.

3. **Print a final summary**: files written (path + line count) and
   sub-agents that failed (if any) with the re-run command for each.

## Sub-agent briefing template

Use this template verbatim when dispatching a sub-agent. The structure is
ordered for prompt-cache hits: everything above the `--- PER-ITEM ---` marker
must be byte-identical across all sub-agents in the same phase; everything
below varies per item.

```
You are a documentation sub-agent for the currently open project.

=== SHARED CONTEXT BUNDLE (identical across all sub-agents in this phase) ===

## Wave-1 outputs

### overview.md
<inline full body of agent-docs/overview.md>

### architecture.md
<inline full body of agent-docs/architecture.md>

### glossary.md
<inline full body of agent-docs/glossary.md>

## Repo map
<inline: tree -L 3 output, language histogram, top-20 most-imported files>

## Linking rules
<inline: verbatim copy of the "Cross-doc linking" section of the orchestrator
prompt — same bytes every brief>

## Frontmatter schema
Required fields: id, title, kind, tags, code_refs, sources. Every source file
the doc cites must appear in code_refs so an agent can fetch it via
read_source_file({ repo, path }). Do not invent fields.

## Phase spec
<inline: full body returned by get_prompt({ id: "<prompt-id>" }), resolved
once by the orchestrator. Do NOT call get_prompt from inside this sub-agent —
that defeats the cached prefix.>

## Tool rules

Read the repo's source code directly through native editor file tools
(Read / Glob / Grep). Do NOT call the `direct-context` MCP server for any
purpose:

  - No `search_agent_docs`, `get_agent_doc`, `list_agent_docs` — they
    return last-ingested (stale) docs.
  - No `read_source_file` — use native Read instead.
  - No `get_prompt` — the phase spec above is the one and only source.

If `agent-docs/<your output path>` already exists, overwrite it without
reading the prior version. The wave-1 outputs above are the only "previous
docs" you may rely on, and they are from this same run.

=== --- PER-ITEM --- (this section varies per sub-agent) ===

Phase: <phase name>
Prompt ID (for traceability): <prompt-id>

Variables:
  <VAR1> = <value1>
  <VAR2> = <value2>

Output: <absolute output path>

Output requirements:
  - End the doc with a "## Related" section of wiki-links matching your
    frontmatter sources, labeled with each source's relation.
  - Return only the absolute output path you wrote, plus any errors. Do not
    stream the doc body back — the file on disk is the deliverable.
```

## Output

This orchestrator prompt does **not** itself produce a markdown doc. It
produces the entire `agent-docs/` set and a minimal `AGENTS.md` at the
repo root.

When you finish, print:

- Files written (path + line count)
- Sub-agents that failed (if any) and the suggested re-run prompt

## Related

- prerequisite: none (this is the entry point)
- drilldown: [overview](overview.md), [architecture](architecture.md), [glossary](glossary.md)
- drilldown: [modules/](modules/), [flows/](flows/), [apis/](apis/)
- companion: every other doc in this set
