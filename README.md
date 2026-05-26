# Direct Context

*An MCP server that turns any repository into searchable agent context.*

`direct-context` is two things in one package:

1. **A doc-generation toolkit.** A library of prompts (under [prompts/](prompts/)) you run against a target repo to produce `agent-docs/` — structured markdown describing how the repo works.
2. **An MCP server.** Loads one or more repos' `agent-docs/` into a local cache and exposes them to agents via MCP tools (`search_agent_docs`, `get_agent_doc`, `read_source_file`, …) and as MCP prompts.

## Features

- **Doc-generation toolkit** — 18 prompts plus a one-shot orchestrator that produce per-repo `agent-docs/`.
- **MCP server** — exposes docs to any MCP client (Cursor, Claude Desktop, etc.) over stdio or HTTP.
- **Multi-repo** — point at any number of local checkouts or GitHub / Bitbucket refs (SSH).
- **Three search engines** — `text` (substring), `bm25` (keyword), `semantic` (MiniLM, in-process).
- **Source-file reads** — sandboxed `read_source_file` follows `code_refs` from docs to the actual files.
- **Zero runtime config** — `pnpm ctx:load` writes everything the server needs; the server reads it on startup.

## Quickstart

### Step 1 — Install

```bash
pnpm install   # requires Node ≥ 20
```

> Remote repos (GitHub / Bitbucket) are cloned over SSH — `ssh-add` your key first if you want to serve any.

### Step 2 — Generate docs for a target repo

Open the target repo in an agentic editor (Claude Code, Cursor, etc.) and run the one-shot orchestrator prompt:

```
prompts/initialize-docs.md
```

This produces `agent-docs/*.md` + `AGENTS.md` inside the target repo. Commit the result to that repo's VCS before continuing.

> To skip or customize phases, see the [doc-generation section](#1-generate-agent-docs) below.

### Step 3 — Configure which repos to serve

```bash
cp context.config.example.json context.config.json
```

Edit `context.config.json` and list each repo by absolute path or remote ref:

```json
{
  "repos": [
    "/Users/me/code/my-repo",
    "owner/some-github-repo@main"
  ]
}
```

### Step 4 — Load docs into the local cache

```bash
pnpm ctx:load   # writes .cache/ctx.yaml
```

### Step 5 — Start the MCP server

```bash
pnpm dev        # stdio — right for IDE clients
pnpm dev:http   # HTTP on :3050
```

### Step 6 — Wire your MCP client

Add the server to your editor's MCP config (Cursor, Claude Desktop, etc.). See [Client configuration](#client-configuration) below for the exact snippet.

> **After editing docs**, re-run `pnpm ctx:load` and restart the server. Docs and embeddings are loaded once at startup — there is no hot-reload.

---

## Usage

### 1. Generate agent docs

Each repo you want to serve needs an `agent-docs/` folder — markdown files with YAML frontmatter describing the repo's architecture, modules, APIs, data flows, runtime behavior, and conventions.

**Recommended: the `initialize-docs` orchestrator.** The fastest path is the one-shot orchestrator at [prompts/initialize-docs.md](prompts/initialize-docs.md). Open the target repo in an agentic editor (Claude Code, Cursor, etc.) that can spawn sub-agents, then run the orchestrator prompt. It:

1. Discovers the repo's modules, flows, APIs, and integrations.
2. Spawns one sub-agent per documentation phase — and one sub-agent per module / flow / API surface — in three waves (foundations → fan-out → system-wide).
3. Each sub-agent reads its own authoritative spec from `prompts/<id>.md` and writes a single markdown file.
4. The orchestrator writes a minimal `AGENTS.md` pointer at the repo root and validates cross-doc wiki-links.

Args you can pass to the orchestrator:

| Arg                  | Meaning                                                  |
|----------------------|----------------------------------------------------------|
| `PARALLEL_SUBAGENTS` | Cap on concurrent sub-agents in waves 2 & 3 (default 4). |
| `SKIP_PHASES`        | Comma-separated prompt IDs to skip (e.g. `13-frontend`). |

**Manual: run individual prompts.** The orchestrator is built on 18 individual prompts under [prompts/](prompts/). Each prompt produces exactly one doc and can be run on its own — useful for partial coverage, re-runs after code changes, or generating a missing doc. They're organized in three tiers:

- **Understand the system (00–06)** — orientation, architecture, per-module deep-dives, data flows, APIs, runtime behavior, glossary.
- **Know the domain (07–12)** — data model, business logic, integrations, permissions, events, errors.
- **Contribute to the system (13–17)** — frontend, deployment, testing, observability, coding patterns.

Each file is self-contained; open it to see its inputs, output path, and the questions it answers. Some take arguments (e.g. `MODULE_NAME`, `FLOW_NAME`) declared in the prompt's frontmatter.

**Output.** The result lives at `agent-docs/` inside the target repo. **Commit it to VCS** — that's how it persists and how this server pulls it later.

```
target-repo/
├── agent-docs/
│   ├── overview.md
│   ├── architecture.md
│   ├── modules/
│   │   ├── auth.md
│   │   └── billing.md
│   ├── apis/
│   │   └── rest-api.md
│   └── …
├── AGENTS.md               # pointer file at the repo root
├── src/
└── …
```

### 2. Load docs

`pnpm ctx:load` reads each configured repo's `agent-docs/` and writes a single merged manifest to `.cache/ctx.yaml`. The server reads `.cache` on startup and resolves all docs from that manifest.

Sources come from `context.config.json` in the package root. There is no CLI flag or env-var override — the config file is the single source of truth.

Drop a `context.config.json` next to `package.json`:

```json
{
  "repos": [
    "/Users/me/code/repo-a",
    "/Users/me/code/repo-b",
    "owner/some-github-repo@main",
    "git@bitbucket.org:team/some-bitbucket-repo.git@feature-branch"
  ]
}
```

The file is gitignored by default. See [context.config.example.json](context.config.example.json) for a template.

Each repo entry supports the following forms:

| Form                                        | Meaning                                                      |
|---------------------------------------------|--------------------------------------------------------------|
| `/abs/path/to/checkout`                     | Local repo — reads `agent-docs/` in place (no copy).        |
| `owner/repo` / `owner/repo@ref`             | GitHub via SSH (`git@github.com:owner/repo.git`).            |
| `github:owner/repo@ref`                     | Same as above, explicit prefix.                              |
| `git@github.com:owner/repo.git@ref`         | Full SSH URL, optional `@ref` suffix.                        |
| `bitbucket:owner/repo@ref`                  | Bitbucket via SSH (`git@bitbucket.org:owner/repo.git`).      |
| `git@bitbucket.org:owner/repo.git@ref`      | Full SSH URL, optional `@ref` suffix.                        |

Remote repos are cloned over SSH, so authentication relies on your local SSH agent / keys. There is no token field — make sure your SSH key has read access to any private repo you list.

For each repo, the loader:

- **Local repos**: reads `<repo>/agent-docs/` in place — docs are not copied.
- **Remote repos**: clones or fetches the repo into `.cache/repos/<repo-name>/`, then reads `agent-docs/` from there.
- Writes a single merged `.cache/ctx.yaml` — a manifest listing every doc across all repos with `id`, `kind`, `tags`, `code_refs`, and a `source_roots:` map so the server auto-registers source roots on startup.

Remote clones are kept under `.cache/repos/` and reused across loads — subsequent `pnpm ctx:load` runs do a shallow `git fetch` + `reset --hard` rather than re-cloning from scratch.

Each repo's `agent-docs/` folder must exist before loading — the loader exits with an error otherwise. Generate it first (step 1).

**Repo names must be unique.** Each repo is identified by the basename of its path (local) or the `repo` portion of its ref (remote). If two entries resolve to the same name (e.g. `/work/foo` and `other-owner/foo`), `ctx:load` fails — rename one of the checkouts or drop one entry.

### 3. Run the server

```bash
# Dev — stdio (default; right for IDE clients)
pnpm dev

# Dev — HTTP on :3050
pnpm dev:http

# Production
pnpm build
node dist/index.js                              # stdio
node dist/index.js --transport http --port 3050 # HTTP
```

The server reads from `.cache/ctx/` by default. Override with `--docs <path>` or `AGENT_DOCS_DIR=<path>`.

## Client configuration

### stdio (Cursor, Claude Desktop)

```json
{
  "mcpServers": {
    "direct-context": {
      "command": "node",
      "args": [
        "/abs/path/to/direct-context/dist/index.js"
      ]
    }
  }
}
```

`.cache/` is resolved relative to the package itself (not the client's working directory), so the client doesn't need a `cwd`. If you want to keep the cache elsewhere, pass `--docs /abs/path` or set `AGENT_DOCS_DIR`.

### HTTP

Start the server:

```bash
node dist/index.js --transport http --port 3050
```

Then point your client at it:

```json
{
  "mcpServers": {
    "direct-context": {
      "url": "http://localhost:3050/"
    }
  }
}
```

## Configuration reference

| Flag             | Env var               | Default       | Notes                                                                                                  |
|------------------|-----------------------|---------------|--------------------------------------------------------------------------------------------------------|
| `--docs`         | `AGENT_DOCS_DIR`      | `.cache`      | Explicit agent-docs directory override.                                                                |
| `--engine`       | `CONTEXT_ENGINE`      | `bm25`        | Default search engine. One of `text`, `bm25`, `semantic`.                                          |
| `--transport`    | `CONTEXT_TRANSPORT`   | `stdio`       | Transport. One of `stdio`, `http`.                                                                     |
| `--port`         | `CONTEXT_PORT`        | `3050`        | Port for HTTP transport. Ignored when transport is `stdio`.                                            |
| `--source-root`  | `AGENT_SOURCE_ROOTS`  | (none)        | Source-code root the `read_source_file` tool may read from. Repeatable flag; env var is comma-separated. |

## MCP tools

| Tool                  | Input                          | Output                                                               |
|-----------------------|--------------------------------|----------------------------------------------------------------------|
| `list_agent_docs`     | (none)                         | `{ count, docs: [{ id, title, kind, tags, path }] }`                 |
| `get_agent_doc`       | `{ id }`                       | `{ id, title, kind, tags, path, code_refs, frontmatter, body }`      |
| `search_agent_docs`   | `{ query, k?, engine? }`       | `{ engine, query, hits: [{ id, title, score, snippet }] }`           |
| `outline_agent_docs`  | (none)                         | `{ tree: OutlineNode[] }`                                            |
| `get_prompt`          | `{ id }`                       | `{ id, description, body, args, sources }`                           |
| `list_source_roots`*  | (none)                         | `{ count, roots: [{ name }] }`                                       |
| `read_source_file`*   | `{ repo, path, max_bytes? }`   | `{ repo, path, bytes, truncated, content }`                          |
| `list_source_dir`*    | `{ repo, path }`               | `{ repo, path, entries: [{ name, path, type }] }`                    |

\* Registered only when at least one source root is configured.

The `engine` argument on `search_agent_docs` lets a single running server compare engines live — useful for picking the right default.

### `code_refs` — pointers from docs to source files

Every agent doc carries a `code_refs:` block in its frontmatter listing the source files it cites. Bare paths and full objects are both accepted:

```yaml
code_refs:
  - services/user-api/src/schemas/user.ts          # bare path
  - repo: platform                                  # full object
    path: services/user-api/src/routes/users.ts
    ref: createUser
    description: "POST /users handler"
```

`get_agent_doc` returns `code_refs` as a typed array. When a doc was loaded multi-repo, any entry missing `repo` is defaulted to the cache directory name — so an agent can pass any entry straight to `read_source_file({ repo, path })` without stitching anything together.

The intended agent loop is: `search_agent_docs` → `get_agent_doc` (returns `code_refs`) → `read_source_file({ repo, path })` for the files it actually needs.

## MCP prompts

Every `*.md` file under `prompts/` (except `README.md` and `_*`-prefixed files) is registered as an MCP prompt. The MCP-protocol prompt name uses the file basename (without `.md`) with non-alphanumeric characters replaced by `_` (e.g. `00-orientation.md` → `00_orientation`). The `get_prompt` tool uses the raw basename without that substitution (e.g. `00-orientation`).

Each prompt's frontmatter declares `args` for any `$VAR` / `${VAR}` tokens it references. These are passed through as documentation for the agent — the server does **not** perform variable substitution at the MCP protocol level. The agent interprets the tokens from the prompt text itself.

## Search engines

| Engine     | Tech                                                                                           | Pros                                               | Cons                                                       |
|------------|------------------------------------------------------------------------------------------------|----------------------------------------------------|------------------------------------------------------------|
| `text`     | substring + tag/title boost                                                                    | zero deps, instant startup, predictable            | exact-match only, no stemming, no semantic recall          |
| `bm25`     | [minisearch](https://lucaong.github.io/minisearch/) (BM25, fuzzy, prefix)                      | strong default for keyword-style queries; no model | still keyword-based                                        |
| `semantic` | [@huggingface/transformers](https://huggingface.co/docs/transformers.js) MiniLM-L6, in-process | conceptual recall ("how do tokens get validated")  | first run downloads the model (cached under `.transformers-cache`); embeds all docs at start |

The semantic engine is initialized lazily on first query, so startup stays snappy if you never use it.

## Architecture

### Doc generation flow

The `initialize-docs` orchestrator runs inside an agentic editor opened on the target repo. It fans out to sub-agents (one per doc), each of which reads its prompt spec, writes one markdown file, and reports back.

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Editor as Editor session<br/>(Claude Code / Cursor)
    participant Orch as Orchestrator<br/>(initialize-docs)
    participant Sub as Sub-agent
    participant Repo as Target repo

    Dev->>Editor: Run initialize-docs prompt
    Editor->>Orch: Execute orchestrator
    Orch->>Repo: Discover modules, flows, APIs
    Repo-->>Orch: Repo structure
    loop per doc — waves 1 → 2 → 3
        Orch->>Sub: Spawn with prompt ID + args
        Sub->>Repo: Read source files
        Repo-->>Sub: Source content
        Sub->>Repo: Write agent-docs/<id>.md
        Sub-->>Orch: Done
    end
    Orch->>Repo: Write AGENTS.md
    Orch->>Orch: Validate cross-doc wiki-links
    Dev->>Repo: git commit agent-docs/
```

### Loader flow

`pnpm ctx:load` reads the repo list from `context.config.json`, reads each repo's `agent-docs/` (in place for local repos; via a cached clone for remote ones), and writes a single merged `.cache/ctx.yaml` that the server reads at runtime.

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant CLI as pnpm ctx:load
    participant Cfg as context.config.json
    participant Local as Local repo
    participant Remote as GitHub / Bitbucket<br/>(SSH)
    participant Repos as .cache/repos/
    participant Cache as .cache/

    Dev->>CLI: pnpm ctx:load
    CLI->>Cfg: Read repo list
    Cfg-->>CLI: ["/path/to/repo-a", "owner/repo-b@main"]

    CLI->>Local: Read agent-docs/ in place (no copy)
    CLI->>Local: Parse frontmatter of every *.md
    Local-->>CLI: docs[] for repo-a

    CLI->>Repos: Shallow clone (or fetch+reset) into .cache/repos/repo-b/
    Repos->>Remote: git clone / git fetch (SSH)
    Remote-->>Repos: Repo at ref
    CLI->>Repos: Read agent-docs/ from clone
    Repos-->>CLI: docs[] for repo-b

    CLI->>Cache: Write ctx.yaml (merged manifest, source_roots map)

    CLI-->>Dev: ✓ 2 repo(s), N total doc(s)
```

### Query loop

At runtime, an agent typically searches docs, fetches a doc's body + `code_refs`, then reads the cited source files directly. The server resolves source paths against registered roots and rejects anything that escapes them.

```mermaid
sequenceDiagram
    participant Agent as Agent<br/>(Cursor / Claude)
    participant MCP as MCP server
    participant Reg as EngineRegistry
    participant Cache as .cache/
    participant Src as Source root<br/>(local checkout)

    Note over MCP: Startup
    MCP->>Cache: loadDocs() — read ctx.yaml + referenced *.md
    Cache-->>MCP: LoadedDocs (docs[], sourceRoots[])
    MCP->>Reg: setDocs(docs)

    Note over Agent,Src: Query loop
    Agent->>MCP: search_agent_docs { query, engine? }
    MCP->>Reg: search(query, engine)
    Reg-->>MCP: hits[{ id, score, snippet }]
    MCP-->>Agent: hits

    Agent->>MCP: get_agent_doc { id }
    MCP->>Cache: Read doc body + frontmatter
    Cache-->>MCP: { body, code_refs[] }
    MCP-->>Agent: doc with code_refs

    Agent->>MCP: read_source_file { repo, path }
    MCP->>Src: Read file (path validated within source root)
    Src-->>MCP: File content
    MCP-->>Agent: { content, bytes, truncated }
```

### Agent-docs format

The on-disk format every `agent-docs/` folder must follow. Step 1 of [Usage](#usage) produces it; step 2's loader consumes it.

#### Folder layout

```
agent-docs/
├── index.yaml          # optional hand-maintained manifest; if absent, loader walks *.md
├── overview.md         # required: top-level overview of the repo
├── architecture.md     # optional: components, boundaries, deployment
├── glossary.md         # optional: domain glossary
├── business-logic.md   # optional: domain rules, invariants, state machines
├── data-model.md       # optional: entities, schemas, migrations
├── permissions.md      # optional: authn/authz, roles, scopes
├── integrations.md     # optional: external service contracts
├── runtime-behavior.md # optional: env vars, config files, feature flags (kind: configuration)
├── jobs.md             # optional: async work, cron, queues
├── events.md           # optional: message contracts, topics
├── errors.md           # optional: error taxonomy, resilience
├── observability.md    # optional: logging, metrics, traces, SLOs
├── deployment.md       # optional: CI/CD, infra, rollout
├── ownership.md        # optional: teams, CODEOWNERS, on-call
├── frontend.md         # optional: UI framework, routing, state, design system
├── compliance.md       # optional: privacy, GDPR, audit, retention
├── testing.md          # optional: test strategy, coverage, fixtures
├── patterns.md         # optional: coding conventions and patterns
├── project-details.md  # optional: compact single-file snapshot
├── modules/            # optional: one file per module
│   └── <name>.md
├── flows/              # optional: one file per data or user flow
│   └── <name>.md
└── apis/               # optional: one file per public API surface
    └── <name>.md
```

If `index.yaml` is absent the loader walks `*.md` recursively under the docs root.

#### File format

Each `.md` file is a plain Markdown document with a top-level heading:

```markdown
# Authentication

…
```

`id`, `title`, and `kind` are inferred from the file's path and first `# ` heading:

| Field   | Inferred from                                                                 |
|---------|-------------------------------------------------------------------------------|
| `id`    | Path relative to the docs root, with the `.md` extension stripped.            |
| `title` | First `# ` heading in the body. Falls back to `id`.                           |
| `kind`  | Path: `modules/` → `module`, `flows/` → `flow`, `apis/` → `api`. Otherwise the basename is matched to a `DocKind` from the table below — `overview`, `architecture`, `glossary`, etc. The filename `runtime-behavior.md` is aliased to `kind: configuration`. Unrecognized basenames fall back to `note`. |
| `tags`  | Empty unless overridden by frontmatter.                                       |

YAML frontmatter is optional. When present, its `id`, `title`, `kind`, and `tags` override the inferred values; any other keys are preserved on the loaded doc:

```markdown
---
id: modules/auth
title: Authentication
kind: module
tags: [auth, security]
source: src/auth          # arbitrary extras are preserved
---

# Authentication
…
```

#### `kind` values

| Kind              | Used for                                          |
|-------------------|---------------------------------------------------|
| `overview`        | Top-level repository overview                     |
| `architecture`    | Components, boundaries, deployment topology       |
| `module`          | One coherent subsystem or package                 |
| `flow`            | Data or user flow through the system              |
| `api`             | Public API surface (HTTP, gRPC, CLI, SDK, events) |
| `glossary`        | Domain glossary                                   |
| `note`            | Free-form note                                    |
| `project-details` | Compact single-file project snapshot              |
| `business-logic`  | Domain rules, invariants, state machines          |
| `data-model`      | Entities, schemas, storage, migrations            |
| `permissions`     | Authentication and authorization                  |
| `integrations`    | External service contracts and topology           |
| `configuration`   | Env vars, config files, feature flags, secrets    |
| `jobs`            | Async work, cron, queues, workers                 |
| `events`          | Message contracts, topics, event bus              |
| `errors`          | Error taxonomy, resilience, retries               |
| `observability`   | Logging, metrics, traces, SLOs, alerts            |
| `deployment`      | CI/CD, infrastructure, rollout strategy           |
| `ownership`       | Teams, CODEOWNERS, on-call rotations              |
| `frontend`        | UI framework, routing, state, design system       |
| `compliance`      | Privacy, GDPR, audit trails, data retention       |
| `testing`         | Test strategy, coverage, fixtures, tooling        |
| `patterns`        | Coding conventions and patterns                   |

Optional frontmatter fields are allowed and preserved by the loader (e.g. `source`, `entrypoint`, `api_kind`, `code_refs`).

#### `index.yaml` manifest

`index.yaml` is the canonical entry point. It is **generated automatically** by `pnpm ctx:load` from the frontmatter of every `*.md` file under the docs root. Authors don't write or maintain it by hand — they only need correct frontmatter (`id`, `title`, `kind`, `tags`) on each markdown file. Any pre-existing `index.yaml` shipped with a source repo is replaced when the docs are loaded into the cache.

Minimum example:

```yaml
title: my-repo
generated_at: 2026-05-01T18:00:00Z
files:
  - id: overview
    path: overview.md
    kind: overview
  - id: modules/auth
    path: modules/auth.md
    kind: module
    tags: [auth]
```

If a file is listed in the manifest, the manifest entry wins (its `id`, `kind`, `tags` are used). If a file exists on disk but isn't in the manifest, it's still loaded (with frontmatter as the source of truth).

## License

MIT — see [LICENSE](LICENSE).
