---
id: coding-patterns
title: "Coding Patterns"
kind: patterns
description: "Document repeatable coding patterns, recipes, and conventions for making changes."
tags: [coding-patterns, conventions, recipes, style, best-practices]
sources:
  - id: testing
    relation: companion
    path: testing.md
    description: "test patterns and conventions"
  - id: architecture
    relation: prerequisite
    path: architecture.md
    description: "structural patterns to stay consistent with"
  - id: modules
    relation: companion
    path: modules/
    description: "concrete examples of patterns in the codebase"
  - id: errors
    relation: companion
    path: errors.md
    description: "how to raise, wrap, and propagate errors"
---

# Coding patterns

You are documenting the repeatable patterns and recipes used in the currently
open project so that a future LLM coding agent can make changes that look
like they were written by the team — not by an outsider who read the docs
but didn't absorb the style.

This is the most practical document in the agent docs. While other maps
explain what the system *is*, this one explains how to *change it*.

## Steps

1. **Code style and conventions**
   - Linter and formatter config (ESLint, Prettier, Biome, Ruff, gofmt…).
   - Import ordering rules.
   - Naming conventions: files, functions, classes, constants, DB columns.
   - Comment style: when are comments expected? JSDoc/docstrings on public
     APIs?

2. **Recipe: Add a new API endpoint**
   - Walk through the exact files to create or modify, in order.
   - Route registration, handler/controller, service method, DTO/schema,
     validation, tests.
   - Show a minimal real example from the repo.

3. **Recipe: Add a new database field**
   - Create migration, update model/entity, update DTOs, update tests.
   - Show the pattern with a real example.

4. **Recipe: Add a new background job / queue consumer**
   - Job definition, scheduling/registration, handler, error handling,
     idempotency.
   - Show the pattern.

5. **Recipe: Add a new event (publish and subscribe)**
   - Define event schema, publish from producer, subscribe in consumer,
     handle failures.
   - Show the pattern.

6. **Recipe: Add a new UI page / feature** (if frontend exists)
   - Create route, page component, data fetching, state management, tests.
   - Show the pattern.

7. **Dependency injection / wiring**
   - How are dependencies constructed and injected? (DI container, manual
     wiring, module imports, factory functions)
   - Where is the composition root?

8. **Common utilities and helpers**
   - List the most-used internal utilities that a contributor should reach for
     instead of writing from scratch.
   - For each: name, location, purpose, example usage.

9. **Recipe: Scaffold a new service or package**
   - Is there a template repo, generator CLI, or cookiecutter?
   - If not, list the minimal boilerplate: directory structure, Dockerfile,
     CI workflow, base dependencies, health endpoint, config loading.
   - How to register the new service with service discovery, API gateway,
     or monorepo workspace.
   - Show the exact steps an agent would follow to go from nothing to a
     deployable skeleton.

10. **Anti-patterns to avoid**
   - Patterns the team has explicitly rejected or moved away from.
   - Known tech debt areas where the pattern is inconsistent — and which
     version to follow.
   - In-progress migrations: list any ongoing "migrate from X to Y" efforts
     with current state (what's done, what remains, which pattern to use
     in new code).

11. **PR checklist**
    - What the team expects in a well-formed PR:
      - Tests covering the change
      - Migration if schema changed
      - Metrics/logging for new endpoints
      - Documentation update if public API changed
      - Feature flag if the change is risky

## Source-file references

For every recipe, link to the real reference files an agent will copy
from. Note the repo-relative path of each (handler example, migration
example, job/consumer example, page example, DI wiring root, utilities).
Emit them in the `code_refs:` block of the output frontmatter so an agent
reading this doc can fetch them via `read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/coding-patterns.md` using
this frontmatter (fill in `title` and `tags` from what you find):

---
id: coding-patterns
title: "Coding Patterns"
kind: patterns
tags: []
code_refs:
  # Reference files agents will copy from for each recipe — handler,
  # migration, job, page, wiring root, common utilities. An agent can
  # fetch each via read_source_file({ repo, path }). `repo` is the
  # source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <recipe or symbol name>
    description: <which recipe this file is the canonical example for>
sources:
  - id: testing
    relation: companion
    path: testing.md
    description: "test patterns and conventions"
  - id: architecture
    relation: prerequisite
    path: architecture.md
    description: "structural patterns to stay consistent with"
  - id: errors
    relation: companion
    path: errors.md
    description: "how to raise, wrap, and propagate errors"
---

Keep the document under 600 lines. **The recipes with real code examples are
the most important part** — an AI agent will use them as templates when making
changes. Prioritize concrete examples over abstract descriptions.
