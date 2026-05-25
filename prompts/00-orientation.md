---
id: overview
title: "Orientation"
kind: overview
description: "Collect a high-level orientation map for the open project."
tags: [orientation, overview, entry-points, project-structure, tech-stack]
sources:
  - id: architecture
    relation: drilldown
    path: architecture.md
    description: "component map and service topology"
  - id: modules
    relation: drilldown
    path: modules/
    description: "drill into individual modules"
  - id: glossary
    relation: companion
    path: glossary.md
    description: "decode domain terms encountered during orientation"
  - id: data-flows
    relation: drilldown
    path: flows/
    description: "trace how requests move through the system"
---

# Orientation

You are documenting the currently open project so that a future LLM coding
agent can understand it without reading every file.

## Goal

Produce a single orientation document that gives a newcomer (human or AI)
enough context to navigate the codebase confidently.

## Steps

1. **Identify the project**
   - Read the project's `README.md`, `package.json`, `pyproject.toml`,
     `go.mod`, or whichever manifest exists at the project root.
   - Determine: project name, one-sentence purpose, primary language(s),
     framework(s), and runtime (Node, JVM, Go, browser, etc.).

2. **Repository coordinates** (critical for tools like GitHub MCP)
   - **GitHub URL**: full `owner/repo` slug (e.g. `acme/platform`).
     Look in `.git/config`, `package.json` `repository` field, or README
     badges.
   - **Default branch**: `main`, `master`, `develop`, or other.
   - **Monorepo or single-service?** If monorepo, list each deployable
     unit with its path prefix (e.g. `services/user-api/`,
     `packages/shared-types/`).
   - **Related repositories**: if this repo depends on or is depended upon
     by sibling repos, list them with their `owner/repo` slugs and
     one-line relationship (e.g. "shared proto definitions",
     "frontend for this API").

3. **Map the directory structure**
   - List top-level directories and describe their role in ≤ 1 sentence each.
   - Note any monorepo / workspace layout (e.g. `packages/`, `apps/`, `services/`).

4. **Find entry points**
   - Where does execution start? (e.g. `src/index.ts`, `cmd/server/main.go`,
     `app/main.py`).
   - List the 3–5 most important files a developer would open first.

5. **Identify key dependencies**
   - External services the project talks to (databases, queues, APIs).
   - Major libraries that shape the architecture (ORM, HTTP framework, state
     management, etc.).

6. **Describe the development workflow**
   - How to install, build, run locally, and run tests (the happy-path
     commands).

7. **Note team conventions**
   - Folder-naming patterns, code style, branching strategy, CI pipeline —
     only what's observable from the repo.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (manifest, README, entry-point file, etc.). Emit them in the
`code_refs:` block of the output frontmatter so an agent reading this doc
can fetch them via `read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/overview.md` using this
frontmatter (fill in `title` and `tags` from what you find):

---
id: overview
title: "<project name>"
kind: overview
tags: []
code_refs:
  # List every source file this doc cites, so an agent can fetch them via
  # read_source_file({ repo, path }). `repo` is the source-root name from
  # list_source_roots. `ref` and `description` are optional.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <optional symbol or line anchor>
    description: <what this file contributes>
sources:
  - id: architecture
    relation: drilldown
    path: architecture.md
    description: "component map and service topology"
  - id: glossary
    relation: companion
    path: glossary.md
    description: "decode domain terms encountered during orientation"
---

Keep the document under 350 lines. Prefer bullet lists and short paragraphs
over prose walls.
