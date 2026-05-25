---
id: runtime-behavior
title: "Runtime Behavior"
kind: configuration
description: "Document runtime behavior: startup, jobs, scaling, and health."
tags: [runtime, startup, shutdown, health, scaling, background-jobs]
sources:
  - id: deployment
    relation: companion
    path: deployment.md
    description: "how the process is packaged, started, and configured"
  - id: observability
    relation: companion
    path: observability.md
    description: "what to monitor once the service is running"
  - id: events
    relation: companion
    path: events.md
    description: "async jobs and background workers"
---

# Runtime behavior

You are documenting how the currently open project behaves at runtime —
startup sequence, background work, scaling characteristics, and operational
health — so that a future LLM coding agent can reason about production
behavior without deploying the code.

## Steps

1. **Startup sequence**
   - What happens from process start to "ready to serve"?
   - Database migrations, cache warming, connection pool setup, config
     loading order.
   - How is readiness signaled? (health endpoint, log line, k8s probe)

2. **Graceful shutdown**
   - Signal handling (SIGTERM, SIGINT).
   - In-flight request draining, connection cleanup, flush buffers.

3. **Background jobs & scheduled tasks**
   - Cron jobs, queue consumers, periodic cleanups.
   - For each: name, schedule/trigger, what it does, failure behavior.

4. **Concurrency model**
   - Single-threaded event loop, thread pool, actor model, goroutines?
   - Known concurrency hazards (shared mutable state, lock contention).

5. **Scaling characteristics**
   - Stateless vs. stateful? Horizontally scalable?
   - Resource bottlenecks (CPU-bound, memory, DB connections, external API
     rate limits).

6. **Health & observability**
   - Health check endpoints and what they verify.
   - Key metrics, logs, and traces an operator should watch.
   - Alerting rules if documented.

7. **Configuration at runtime**
   - Environment variables, config files, feature flags, secrets.
   - Which config requires a restart vs. hot-reload?

8. **Lifecycle diagrams**
   - Produce a Mermaid `sequenceDiagram` of the startup sequence
     (process start → migrations → pools / caches → readiness signal),
     and a `stateDiagram-v2` for the running process's high-level states
     (e.g. `booting → ready → draining → stopped`, with health-check
     transitions). Skip whichever doesn't apply.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (entry point, signal handlers, scheduled-job definitions, health
endpoints, config loaders). Emit them in the `code_refs:` block of the
output frontmatter so an agent reading this doc can fetch them via
`read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/runtime-behavior.md` using
this frontmatter (fill in `title` and `tags` from what you find):

---
id: runtime-behavior
title: "Runtime Behavior"
kind: configuration
tags: []
code_refs:
  # Entry point, signal/shutdown handlers, scheduled jobs, health checks.
  # An agent can fetch each via read_source_file({ repo, path }). `repo`
  # is the source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <optional symbol or line anchor>
    description: <what this file contributes>
sources:
  - id: deployment
    relation: companion
    path: deployment.md
    description: "how the process is packaged, started, and configured"
  - id: observability
    relation: companion
    path: observability.md
    description: "what to monitor once the service is running"
  - id: events
    relation: companion
    path: events.md
    description: "async jobs and background workers"
---

Keep the document under 400 lines. Include the Mermaid lifecycle
diagrams produced in step 8 (startup `sequenceDiagram` and/or process
`stateDiagram-v2`).
