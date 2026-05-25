---
id: data-flows
title: "Data-flow Trace"
kind: flow
description: "Trace a data flow end-to-end through the open project."
tags: [data-flow, request-lifecycle, trace, end-to-end]
sources:
  - id: apis
    relation: companion
    path: apis/
    description: "contracts at each hop in the flow"
  - id: events
    relation: companion
    path: events.md
    description: "async steps driven by events"
  - id: data-model
    relation: companion
    path: data-model.md
    description: "shape of data at rest along the flow"
  - id: errors
    relation: companion
    path: errors.md
    description: "failure modes and propagation at each step"
args:
  FLOW_NAME:
    description: "Short slug for the flow (e.g. 'user-signup', 'order-checkout')."
    required: true
  ENTRYPOINT:
    description: "Where the flow begins — file path, route, or event name."
    required: true
---

# Data-flow trace

You are tracing a single end-to-end data flow through the currently open
project so that a future LLM coding agent can follow the full path without
reading every file.

## Target

- **Flow**: $FLOW_NAME
- **Entry point**: `$ENTRYPOINT`

## Steps

1. **Trigger**
   - What initiates this flow? (HTTP request, scheduled job, queue message,
     user action, webhook…)
   - Include the exact route / event / cron expression.

2. **Step-by-step walkthrough**
   - Follow the data from trigger to final side-effect.
   - For each step note:
     - File and function/method
     - What transformation or validation happens
     - What is passed to the next step (payload shape, key fields)

3. **Data stores touched**
   - Which tables, collections, caches, or queues are read or written?
   - Note the order of writes and whether they're in a transaction.

4. **External calls**
   - Third-party APIs, other microservices, email/SMS providers — anything
     that crosses a network boundary.

5. **Error & retry paths**
   - What happens when a step fails?
   - Dead-letter queues, compensating transactions, user-facing error codes.

6. **Diagrams**
   Produce all that apply for this flow. Together they should let an
   agent reconstruct the flow without reading the source.
   - **Sequence diagram** (always) — Mermaid `sequenceDiagram` of the
     happy path: every participant (client, service, store, external
     API, queue) and the messages between them, in order.
   - **Branching flowchart** (when the flow forks) — Mermaid `flowchart`
     showing the decision points: validation pass/fail, idempotency
     hits, success vs. error branches, retry / dead-letter paths.
   - **State diagram** (when an entity moves through statuses) — Mermaid
     `stateDiagram-v2` for the lifecycle of the primary entity touched
     by the flow (e.g. order: `pending → paid → shipped → delivered`,
     with `cancelled` / `refunded` transitions).
   - Keep each diagram focused on one concern — don't try to cram
     branching and timing into a single picture.

## Source-file references

While tracing, note the repo-relative path of every source file each step
touches (route handler, service method, repository, queue producer, etc.).
Emit them in the `code_refs:` block of the output frontmatter so an agent
reading this doc can fetch them via `read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/flows/${FLOW_NAME}.md`
using this frontmatter (fill in `title` and `tags` from what you find):

---
id: flows/${FLOW_NAME}
title: "${FLOW_NAME} flow"
kind: flow
tags: []
code_refs:
  # One entry per file touched in the flow, in step order if possible.
  # An agent can fetch each via read_source_file({ repo, path }). `repo`
  # is the source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <function or step name>
    description: <which step in the flow this file owns>
sources:
  - id: events
    relation: companion
    path: events.md
    description: "async steps driven by events"
  - id: data-model
    relation: companion
    path: data-model.md
    description: "shape of data at rest along the flow"
  - id: errors
    relation: companion
    path: errors.md
    description: "failure modes and propagation at each step"
---

Keep the document under 400 lines. Use numbered lists for the
walkthrough and the Mermaid diagrams from step 6 (always a
`sequenceDiagram`; add a `flowchart` for branches and a
`stateDiagram-v2` for entity status when they apply).
