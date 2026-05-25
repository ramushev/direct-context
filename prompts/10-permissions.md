---
id: permissions
title: "Permissions"
kind: permissions
description: "Document the authentication and authorization model."
tags: [permissions, authentication, authorization, security, rbac, jwt]
sources:
  - id: apis
    relation: companion
    path: apis/
    description: "endpoints where auth is enforced"
  - id: errors
    relation: companion
    path: errors.md
    description: "401/403 error shapes and handling"
  - id: integrations
    relation: companion
    path: integrations.md
    description: "cross-service auth and token exchange"
---

# Permissions

You are documenting how authentication (who are you?) and authorization (what
can you do?) work in the currently open project so that a future LLM coding
agent can add endpoints, modify access rules, or debug permission issues
without introducing security holes.

## Steps

1. **Authentication mechanisms**
   - How do users authenticate? (session cookie, JWT, OAuth2, API key,
     SSO/SAML, magic link, passkey…)
   - Where is the auth logic? (middleware, gateway, library)
   - Token format, issuer, expiration, refresh flow.
   - How is the authenticated user attached to the request context?

2. **Identity model**
   - What represents a "user"? (User table, external IdP subject, API key
     record…)
   - Multi-tenancy? How is tenant isolation enforced?
   - Service-to-service identity — how do internal services authenticate to
     each other?

3. **Authorization model**
   - Is it RBAC (roles), ABAC (attributes), ACL (per-resource), policy-based
     (OPA/Cedar), or ad-hoc checks?
   - List all roles/scopes/permissions and what each grants.
   - Where are authorization checks enforced? (middleware, decorator,
     service layer, DB row-level security)

4. **Permission matrix**
   - For the most important resources/actions, build a matrix:

   | Resource      | Action   | Admin | Member | Guest | Service |
   |---------------|----------|-------|--------|-------|---------|
   | User          | read     | yes   | self   | no    | yes     |
   | User          | update   | yes   | self   | no    | no      |
   | Order         | create   | yes   | yes    | no    | yes     |
   | …             | …        | …     | …      | …     | …       |

5. **Elevation and impersonation**
   - Can admins act as another user? How?
   - Sudo / elevated-privilege flows.

6. **Token and session lifecycle**
   - Creation, refresh, revocation, expiry.
   - Where are tokens stored client-side? (cookie flags, localStorage…)

7. **Common pitfalls**
   - Known authorization gaps or tech-debt items.
   - Places where a missing check has caused (or could cause) bugs.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (auth middleware, identity-resolution code, policy definitions,
guard functions). Emit them in the `code_refs:` block of the output
frontmatter so an agent reading this doc can fetch them via
`read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/permissions.md` using this
frontmatter (fill in `title` and `tags` from what you find):

---
id: permissions
title: "Permissions"
kind: permissions
tags: []
code_refs:
  # Auth middleware, identity resolvers, policy/role definitions, guards.
  # An agent can fetch each via read_source_file({ repo, path }). `repo`
  # is the source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <role or guard name>
    description: <what this file enforces>
sources:
  - id: apis
    relation: companion
    path: apis/
    description: "endpoints where auth is enforced"
  - id: errors
    relation: companion
    path: errors.md
    description: "401/403 error shapes and handling"
  - id: integrations
    relation: companion
    path: integrations.md
    description: "cross-service auth and token exchange"
---

Keep the document under 400 lines. Use the permission matrix table and bullet
lists for the rest.
