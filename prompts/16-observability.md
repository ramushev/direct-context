---
id: observability
title: "Observability"
kind: observability
description: "Document observability patterns: logging, metrics, tracing, and alerting."
tags: [observability, logging, metrics, tracing, alerting, instrumentation]
sources:
  - id: errors
    relation: companion
    path: errors.md
    description: "what gets logged and alerted on"
  - id: runtime-behavior
    relation: companion
    path: runtime-behavior.md
    description: "lifecycle events that need instrumentation"
  - id: deployment
    relation: companion
    path: deployment.md
    description: "where logs and metrics are shipped"
---

# Observability

You are documenting how the currently open project implements observability —
structured logging, metrics, distributed tracing, and alerting — so that a
future LLM coding agent can instrument new code correctly and debug
production issues using the existing tooling.

When an AI agent adds a new endpoint or flow, it must add the right log lines,
metrics, and trace spans or the change is incomplete.

## Steps

1. **Logging**
   - Logger library and configuration (Winston, Pino, Bunyan, Logback,
     zerolog, Python logging…).
   - Structured vs. unstructured. Log format (JSON, logfmt, plain text).
   - Log levels used and when to use each (debug, info, warn, error).
   - Standard fields included in every log line (request ID, user ID,
     service name, trace ID…).
   - Where is the logger instantiated? How do you get a logger in new code?
   - PII and sensitive data rules — what must never be logged.

2. **Metrics**
   - Metrics library (Prometheus client, StatsD, Datadog SDK, OpenTelemetry
     metrics…).
   - Metric types used: counters, gauges, histograms, summaries.
   - Naming convention (e.g. `http_requests_total`, `service.request.duration`).
   - Standard metrics already collected (request latency, error rate, queue
     depth, DB query time…).
   - How to add a new metric — show the pattern with a real example from the
     repo.
   - Where are metrics exposed? (`:9090/metrics`, pushed to collector…)

3. **Distributed tracing**
   - Tracing library (OpenTelemetry, Jaeger client, Datadog APM, X-Ray…).
   - How are traces propagated across services? (W3C trace context,
     B3 headers, custom header)
   - Auto-instrumentation vs. manual spans.
   - How to create a new span — show the pattern.
   - Where are traces exported to? (Jaeger, Tempo, Datadog, Honeycomb…)

4. **Health checks and readiness probes**
   - Endpoints: `/health`, `/ready`, `/live` — what does each check?
   - How to add a new dependency to the health check.

5. **Alerting**
   - Where are alert rules defined? (Prometheus rules, Datadog monitors,
     PagerDuty, Grafana…)
   - Key alerts that exist and what they fire on.
   - On-call rotation pointers (if documented in repo).

6. **Dashboards**
   - Are there dashboards checked into the repo? (Grafana JSON, Datadog
     dashboard-as-code)
   - Key dashboards and what they show.

7. **Error tracking**
   - Error tracking service (Sentry, Bugsnag, Datadog Error Tracking…).
   - How are errors reported? SDK initialization, context enrichment.
   - How to add context to an error report (user ID, request params, etc.).

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (logger setup, metrics registry, tracer init, health endpoints,
alert rules checked into the repo). Emit them in the `code_refs:` block
of the output frontmatter so an agent reading this doc can fetch them via
`read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/observability.md` using
this frontmatter (fill in `title` and `tags` from what you find):

---
id: observability
title: "Observability"
kind: observability
tags: []
code_refs:
  # Logger setup, metrics registry, tracer init, health endpoints, alert
  # rules in the repo. An agent can fetch each via
  # read_source_file({ repo, path }). `repo` is the source-root name from
  # list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <optional symbol or line anchor>
    description: <what this file contributes>
sources:
  - id: errors
    relation: companion
    path: errors.md
    description: "what gets logged and alerted on"
  - id: runtime-behavior
    relation: companion
    path: runtime-behavior.md
    description: "lifecycle events that need instrumentation"
  - id: deployment
    relation: companion
    path: deployment.md
    description: "where logs and metrics are shipped"
---

Keep the document under 400 lines. Include code snippets showing the exact
patterns for adding a log line, a metric, and a trace span — these are what
an AI agent will copy when instrumenting new code.
