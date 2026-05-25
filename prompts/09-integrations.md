---
id: integrations
title: "Integrations"
kind: integrations
description: "Document cross-service and third-party integration contracts."
tags: [integrations, third-party, services, contracts, webhooks, sdks]
sources:
  - id: apis
    relation: companion
    path: apis/
    description: "internal API contracts that mirror or wrap integrations"
  - id: events
    relation: companion
    path: events.md
    description: "webhook and event streams produced by integrations"
  - id: errors
    relation: companion
    path: errors.md
    description: "failure modes and retry strategies per integration"
  - id: permissions
    relation: companion
    path: permissions.md
    description: "auth tokens and scopes required by each integration"
args:
  INTEGRATION_NAME:
    description: "Specific integration to focus on (e.g. 'stripe', 'user-service'). Omit for all."
    required: false
---

# Integrations

You are documenting every integration the currently open project has with
other services — both internal microservices and external third-party APIs —
so that a future LLM coding agent knows the exact contracts, auth mechanisms,
and failure modes when making changes that cross service boundaries.

## Steps

1. **Inventory all outbound calls**
   - Scan for HTTP clients, gRPC stubs, SDK imports, queue publishers,
     webhook dispatchers.
   - For each, record: target service/API name, protocol, base URL or
     service discovery method.

2. **Inventory all inbound contracts**
   - What do other services call on *this* project?
   - Webhooks received, gRPC services served, shared library exports.

3. **For each integration, document the contract**

   | Field              | What to capture                                              |
   |--------------------|--------------------------------------------------------------|
   | Name               | Human-readable name (e.g. "Stripe Payments API")             |
   | Direction          | outbound / inbound / bidirectional                           |
   | Protocol           | REST, gRPC, GraphQL, WebSocket, queue, SDK                   |
   | Base URL / topic   | How is the target addressed?                                 |
   | Source repo        | GitHub `owner/repo` + path (for internal services)           |
   | Authentication     | API key, OAuth token, mTLS, service account — where stored?  |
   | Key endpoints used | Method + path (or RPC name) + purpose                        |
   | Request shape      | TypeScript interface, JSON example, or proto message          |
   | Response shape     | Same as above                                                |
   | Error handling     | Expected error codes, retry policy, circuit breaker config    |
   | Timeout            | Configured timeout value                                     |
   | Rate limits        | Known limits, backoff strategy                               |
   | Idempotency        | Idempotency key header? Safe to retry?                       |

4. **Dependency graph**
   - Produce a Mermaid diagram showing this project and all services/APIs it
     talks to, with labeled edges (protocol + purpose).

5. **Shared types and contracts**
   - Are there shared proto files, OpenAPI specs, JSON Schema, or shared npm
     packages that define the contract?
   - Where do they live? Provide the GitHub `owner/repo` and path so an AI
     agent can read them directly.
   - How are they versioned?

6. **Local development stubs**
   - How are external dependencies faked locally? (mocks, docker-compose
     services, sandbox environments, recorded fixtures)

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (client wrappers, SDK init, webhook handlers, shared proto/schema
files, fixture/mocks). Emit them in the `code_refs:` block of the output
frontmatter so an agent reading this doc can fetch them via
`read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/integrations.md` using
this frontmatter (fill in `title` and `tags` from what you find):

---
id: integrations
title: "Integrations"
kind: integrations
tags: []
code_refs:
  # Client wrappers, webhook handlers, shared schemas, local stubs. An
  # agent can fetch each via read_source_file({ repo, path }). `repo` is
  # the source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <integration or symbol name>
    description: <which integration this file covers>
sources:
  - id: apis
    relation: companion
    path: apis/
    description: "internal API contracts that mirror or wrap integrations"
  - id: events
    relation: companion
    path: events.md
    description: "webhook and event streams produced by integrations"
  - id: errors
    relation: companion
    path: errors.md
    description: "failure modes and retry strategies per integration"
  - id: permissions
    relation: companion
    path: permissions.md
    description: "auth tokens and scopes required by each integration"
---

Keep the document under 500 lines. Use the table format above for each
integration and a Mermaid graph for the dependency overview.
