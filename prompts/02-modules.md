---
id: modules
title: "Module Deep-dive"
kind: module
description: "Deep-dive into a single module or service within the open project."
tags: [modules, services, packages, boundaries, deep-dive]
sources:
  - id: architecture
    relation: prerequisite
    path: architecture.md
    description: "how this module fits into the larger system"
  - id: data-flows
    relation: companion
    path: flows/
    description: "flows that pass through this module"
  - id: apis
    relation: companion
    path: apis/
    description: "API surface this module exposes or consumes"
  - id: business-logic
    relation: companion
    path: business-logic.md
    description: "domain rules owned by this module"
  - id: coding-patterns
    relation: companion
    path: coding-patterns.md
    description: "conventions to follow when changing this module"
args:
  MODULE_NAME:
    description: "Human-readable name of the module (e.g. 'auth', 'billing')."
    required: true
  MODULE_PATH:
    description: "Path to the module root relative to the project root (e.g. 'src/modules/auth')."
    required: true
---

# Module deep-dive

You are documenting a single module (or service / package / bounded context)
inside the currently open project so that a future LLM coding agent knows
exactly what it does, how it's structured, and where the boundaries are.

## Target

- **Module**: $MODULE_NAME
- **Location**: `$MODULE_PATH` (relative to the project root)

## Steps

1. **Purpose & scope**
   - What business capability does this module own?
   - What is explicitly *not* its responsibility?

2. **Public interface**
   - Exported functions, classes, REST/gRPC endpoints, event handlers, CLI
     commands — whatever the module exposes to the rest of the system.
   - For each: name, signature (or route), and one-line purpose.

3. **Internal structure**
   - Key files and subdirectories inside `$MODULE_PATH`, with roles.
   - Important internal types / models.

4. **Dependencies**
   - Other modules this one imports or calls.
   - External services or stores it uses directly.

5. **Configuration & feature flags**
   - Environment variables, config keys, or feature flags this module reads.

6. **Error handling & edge cases**
   - Known failure modes, retry strategies, circuit breakers.

7. **Testing**
   - Where are the tests? What kind (unit, integration, e2e)?
   - Any notable test fixtures or mocks.

8. **Module diagram**
   - Produce a Mermaid `flowchart` showing the module's boundary: public
     interface (entry points on one side), key internal files /
     submodules, and outgoing dependencies (other modules + external
     services) on the other. Aim for a single screen — group fine-grained
     items into labeled subgraphs if needed.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (public entry points, key internal files, test files). Emit them in
the `code_refs:` block of the output frontmatter so an agent reading this
doc can fetch them via `read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/modules/${MODULE_NAME}.md`
using this frontmatter (fill in `title` and `tags` from what you find):

---
id: modules/${MODULE_NAME}
title: "${MODULE_NAME}"
kind: module
tags: []
code_refs:
  # List every source file this doc cites, so an agent can fetch them via
  # read_source_file({ repo, path }). `repo` is the source-root name from
  # list_source_roots. `ref` and `description` are optional.
  - repo: <source-root name>
    path: ${MODULE_PATH}/<file.ext>
    ref: <optional symbol or line anchor>
    description: <what this file contributes>
sources:
  - id: architecture
    relation: prerequisite
    path: architecture.md
    description: "how this module fits into the larger system"
  - id: business-logic
    relation: companion
    path: business-logic.md
    description: "domain rules owned by this module"
  - id: coding-patterns
    relation: companion
    path: coding-patterns.md
    description: "conventions to follow when changing this module"
---

Keep the document under 400 lines. Use tables for interface listings,
bullet lists elsewhere, and a Mermaid `flowchart` for the module
diagram.
