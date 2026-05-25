---
id: modules/auth
title: Authentication
kind: module
tags: [auth, security]
source: src/auth
code_refs:
  - src/auth/jwt.ts
  - path: src/auth/middleware.ts
    ref: requireSession
    description: "Express middleware that loads the session for every request."
---

# Authentication

The Authentication module issues and validates JWT session tokens for every
API request. Sessions are stored in Redis with a 30-day TTL.

## Responsibilities

- Issue a signed JWT on successful login.
- Validate the JWT and load the session on every request.
- Refresh the session sliding window when the JWT is close to expiry.

## Key files

- `src/auth/jwt.ts` — sign / verify helpers
- `src/auth/session.ts` — session cache backed by Redis
- `src/auth/middleware.ts` — Express middleware wiring it all together
