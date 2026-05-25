---
id: glossary
title: "Glossary"
kind: glossary
description: "Build a glossary of domain-specific terms used in the open project."
tags: [glossary, domain, terminology, jargon, abbreviations]
sources:
  - id: business-logic
    relation: companion
    path: business-logic.md
    description: "where most domain terms originate"
  - id: data-model
    relation: companion
    path: data-model.md
    description: "entities and fields that introduce domain vocabulary"
  - id: overview
    relation: prerequisite
    path: overview.md
    description: "project overview that uses these terms"
---

# Glossary

You are building a glossary of domain-specific terms, abbreviations, and
internal jargon found in the currently open project so that a future LLM
coding agent can understand the codebase without domain expertise.

## Steps

1. **Scan for domain language**
   - Read README, doc comments, model/type names, database column names,
     enum values, and error messages.
   - Look for terms that a general-purpose developer would not immediately
     understand.

2. **Collect terms**
   - For each term provide:
     - **Term**: the word or phrase as it appears in code.
     - **Definition**: 1–2 sentence plain-English explanation.
     - **Context**: where it appears (model name, API field, UI label…).
     - **Aliases**: alternative spellings or abbreviations if any.

3. **Include**
   - Business-domain terms (e.g. "tenant", "SKU", "claim", "underwriting").
   - Internal project names or codenames.
   - Abbreviations and acronyms (e.g. "PII", "LTV", "DAU").
   - Status/enum values that encode domain meaning (e.g. "PENDING_REVIEW").

4. **Exclude**
   - General programming terms (e.g. "class", "promise", "goroutine").
   - Well-known framework terms unless the project redefines them.

5. **Organize**
   - Sort alphabetically.
   - Group by subdomain if the project spans multiple business areas.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (model definitions where a term originates, enum files, README
sections). Emit them in the `code_refs:` block of the output frontmatter
so an agent reading this doc can fetch them via
`read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/glossary.md` using this
frontmatter (fill in `title` and `tags` from what you find):

---
id: glossary
title: "Glossary"
kind: glossary
tags: []
code_refs:
  # Source files where domain terms are defined or first appear. An agent
  # can fetch each via read_source_file({ repo, path }). `repo` is the
  # source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <term or symbol>
    description: <which terms this file defines>
sources:
  - id: business-logic
    relation: companion
    path: business-logic.md
    description: "where most domain terms originate"
  - id: data-model
    relation: companion
    path: data-model.md
    description: "entities and fields that introduce domain vocabulary"
  - id: overview
    relation: prerequisite
    path: overview.md
    description: "project overview that uses these terms"
---

Format terms as a Markdown definition list or table. Keep the document under
300 lines.
