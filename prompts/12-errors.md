---
id: errors
title: "Errors"
kind: errors
description: "Document error handling conventions, codes, and propagation patterns."
tags: [errors, error-handling, error-codes, propagation, conventions]
sources:
  - id: coding-patterns
    relation: companion
    path: coding-patterns.md
    description: "how to raise and wrap errors in this codebase"
  - id: observability
    relation: companion
    path: observability.md
    description: "how errors are logged, traced, and alerted on"
  - id: apis
    relation: companion
    path: apis/
    description: "error shapes exposed over the network"
---

# Errors

You are documenting how errors are structured, propagated, and handled in the
currently open project so that a future LLM coding agent can raise, catch,
and surface errors consistently when writing new code.

## Steps

1. **Error shape / base class**
   - Is there a custom error class, error factory, or standard error shape?
   - Fields: code, message, HTTP status, internal status, details/metadata,
     stack trace policy.
   - Show the canonical error type definition.

2. **Error code catalog**
   - List known error codes with:

   | Code              | HTTP Status | Meaning                          | When raised               |
   |-------------------|-------------|----------------------------------|---------------------------|
   | `AUTH_EXPIRED`    | 401         | Token has expired                | Auth middleware            |
   | `NOT_FOUND`       | 404         | Resource does not exist          | Service layer              |
   | `VALIDATION_ERR`  | 422         | Input failed validation          | Request validation         |
   | …                 | …           | …                                | …                         |

3. **Error propagation patterns**
   - How do errors flow from deep service logic to the API response?
   - Is there a global error handler / error middleware?
   - How are errors translated across boundaries? (e.g. gRPC status to HTTP
     status, internal error to user-facing message)

4. **Logging and reporting**
   - Which errors are logged? At what level? (warn vs error)
   - Which errors are reported to an error tracker? (Sentry, Bugsnag,
     Datadog, etc.)
   - PII scrubbing rules — what must never appear in logs?

5. **Client-facing error format**
   - What shape does the API consumer see?
   - Example error response (JSON).
   - How are validation errors returned? (single message vs. per-field array)

6. **Retry vs. fail-fast**
   - Which errors are retryable? Which are terminal?
   - How does the system signal this? (specific codes, `Retry-After` header,
     error metadata)

7. **Common anti-patterns to avoid**
   - Swallowed errors, generic catch-all, inconsistent error shapes.
   - Note any known tech debt around error handling.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (canonical error class, error-code catalog, global error handler,
logger/reporter init). Emit them in the `code_refs:` block of the output
frontmatter so an agent reading this doc can fetch them via
`read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/errors.md` using this
frontmatter (fill in `title` and `tags` from what you find):

---
id: errors
title: "Errors"
kind: errors
tags: []
code_refs:
  # Error class, code catalog, global handler, reporter init. An agent
  # can fetch each via read_source_file({ repo, path }). `repo` is the
  # source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <class or symbol name>
    description: <what this file contributes>
sources:
  - id: coding-patterns
    relation: companion
    path: coding-patterns.md
    description: "how to raise and wrap errors in this codebase"
  - id: observability
    relation: companion
    path: observability.md
    description: "how errors are logged, traced, and alerted on"
  - id: apis
    relation: companion
    path: apis/
    description: "error shapes exposed over the network"
---

Keep the document under 400 lines. Use the error code table and code blocks
for the canonical error shape.
