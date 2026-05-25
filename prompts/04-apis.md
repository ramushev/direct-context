---
id: apis
title: "API Documentation"
kind: api
description: "Document an API surface exposed or consumed by the open project."
tags: [api, rest, graphql, grpc, endpoints, contracts]
sources:
  - id: permissions
    relation: companion
    path: permissions.md
    description: "who is allowed to call each endpoint"
  - id: errors
    relation: companion
    path: errors.md
    description: "error shapes and status codes returned"
  - id: integrations
    relation: companion
    path: integrations.md
    description: "external callers and upstream dependencies"
  - id: data-flows
    relation: companion
    path: flows/
    description: "end-to-end flows that use this API"
args:
  API_NAME:
    description: "Name of the API (e.g. 'user-service', 'admin-dashboard-bff')."
    required: true
  API_KIND:
    description: "Type of API: rest, graphql, grpc, websocket, event, cli."
    required: true
---

# API documentation

You are documenting an API surface in the currently open project so that a
future LLM coding agent knows every endpoint, its contract, and how to
call it.

## Target

- **API**: $API_NAME
- **Kind**: $API_KIND

## Steps

1. **Overview**
   - What does this API serve? Who are its consumers?
   - Base URL / package / proto file location.

2. **Authentication & authorization**
   - How do callers authenticate? (Bearer token, API key, cookie, mTLS…)
   - Are there role-based or scope-based restrictions?

3. **Endpoint inventory**
   - For **REST**: method, path, summary, request body shape, response shape,
     status codes.
   - For **GraphQL**: queries, mutations, subscriptions — with key input/output
     types.
   - For **gRPC**: service name, RPC methods, request/response messages.
   - For **events**: topic/queue, message schema, producer, consumer(s).
   - For **CLI**: commands, flags, exit codes.

4. **Shared types**
   - DTOs, enums, error codes that appear across multiple endpoints.

5. **Rate limiting & pagination**
   - Limits, headers, cursor/offset patterns.

6. **Versioning**
   - How is the API versioned? (URL prefix, header, none)
   - Any deprecated endpoints still live?

7. **Example requests**
   - 2–3 curl / client-code snippets for the most common operations.

8. **Request lifecycle diagram**
   - Produce a Mermaid `sequenceDiagram` for one representative endpoint
     showing the full call chain — client → middleware / auth →
     handler → service → data store (and any downstream calls) →
     response. This gives an agent a visual handle on how a request
     flows through the API before drilling into individual handlers.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (route registration, handlers, schema definitions, OpenAPI/proto
files, shared types). Emit them in the `code_refs:` block of the output
frontmatter so an agent reading this doc can fetch them via
`read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/apis/${API_NAME}.md`
using this frontmatter (fill in `title` and `tags` from what you find):

---
id: apis/${API_NAME}
title: "${API_NAME} API"
kind: api
tags: []
code_refs:
  # Endpoint/handler files, schema files, shared types. An agent can fetch
  # each via read_source_file({ repo, path }). `repo` is the source-root
  # name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <endpoint or symbol name>
    description: <what this file contributes>
sources:
  - id: permissions
    relation: companion
    path: permissions.md
    description: "who is allowed to call each endpoint"
  - id: errors
    relation: companion
    path: errors.md
    description: "error shapes and status codes returned"
  - id: integrations
    relation: companion
    path: integrations.md
    description: "external callers and upstream dependencies"
---

Keep the document under 500 lines. Use tables for endpoint inventories
and a Mermaid `sequenceDiagram` for the request lifecycle.
