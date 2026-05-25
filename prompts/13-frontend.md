---
id: frontend
title: "Frontend"
kind: frontend
description: "Document frontend architecture: components, state, routing, and patterns."
tags: [frontend, react, components, state-management, routing, ui]
sources:
  - id: apis
    relation: companion
    path: apis/
    description: "engine contracts the frontend calls"
  - id: data-flows
    relation: companion
    path: flows/
    description: "user-facing flows this UI implements"
  - id: coding-patterns
    relation: companion
    path: coding-patterns.md
    description: "frontend-specific coding conventions"
  - id: testing
    relation: companion
    path: testing.md
    description: "component and integration test patterns"
args:
  APP_NAME:
    description: "Name of the frontend app (e.g. 'admin-dashboard', 'customer-portal'). Omit to document the primary app."
    required: false
---

# Frontend

You are documenting the frontend architecture of the currently open project
so that a future LLM coding agent can add pages, modify components, and
manage state without breaking patterns or introducing inconsistencies.

## Steps

1. **Framework and tooling**
   - Framework: React, Vue, Svelte, Angular, Next.js, Nuxt, SvelteKit…
   - Build tool: Vite, Webpack, Turbopack, esbuild…
   - Language: TypeScript, JavaScript, TypeScript strict mode?
   - CSS approach: Tailwind, CSS Modules, styled-components, vanilla CSS…
   - Package manager and workspace setup.

2. **Directory structure**
   - Map the top-level frontend directories and their roles.
   - Where do pages, components, hooks/composables, utilities, types,
     assets, and tests live?
   - Naming conventions (PascalCase components, kebab-case files, etc.).

3. **Component architecture**
   - Component hierarchy: layout → page → section → atomic.
   - Shared / reusable component library — where is it? How are components
     documented? (Storybook, docs site, inline)
   - How are props typed? Required vs. optional conventions.

4. **State management**
   - Global state: Redux, Zustand, Pinia, Vuex, Context, signals, stores…
   - Server state: React Query, SWR, Apollo, tRPC…
   - Where are stores / queries defined?
   - Caching, invalidation, and optimistic update patterns.

5. **Routing**
   - Router library and configuration location.
   - Route naming convention.
   - Dynamic routes, nested layouts, route guards / middleware.
   - How are protected routes handled? (redirect to login, role check)

6. **Data fetching patterns**
   - How does the frontend talk to the engine? (REST client, GraphQL,
     tRPC, generated SDK)
   - Where is the API client configured? (base URL, auth headers,
     interceptors)
   - Loading, error, and empty states — standard patterns.

7. **Forms and validation**
   - Form library (React Hook Form, Formik, VeeValidate, native…).
   - Validation approach (Zod, Yup, inline, server-side only).
   - Standard form submission flow.

8. **Testing**
   - Unit tests: tool and conventions (Vitest, Jest, Testing Library…).
   - E2E tests: tool and patterns (Playwright, Cypress…).
   - Where do test files live relative to components?

9. **Accessibility and i18n**
   - Accessibility standards followed (WCAG level).
   - Internationalization library and translation file locations.

10. **Architecture diagram**
    - Produce a Mermaid `flowchart` showing the high-level frontend
      shape: the route tree (or a representative slice of it), shared
      layouts, state stores, and the API client. Goal: one diagram an
      agent can glance at to place a new page or component in the right
      slot.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (router config, shared layouts, store/query setup, API client,
representative page or component). Emit them in the `code_refs:` block of
the output frontmatter so an agent reading this doc can fetch them via
`read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/frontend.md` using this
frontmatter (fill in `title` and `tags` from what you find):

---
id: frontend
title: "Frontend"
kind: frontend
tags: []
code_refs:
  # Router config, layouts, stores, API client, representative pages /
  # components. An agent can fetch each via
  # read_source_file({ repo, path }). `repo` is the source-root name from
  # list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <component or symbol>
    description: <what this file contributes>
sources:
  - id: coding-patterns
    relation: companion
    path: coding-patterns.md
    description: "frontend-specific coding conventions"
  - id: testing
    relation: companion
    path: testing.md
    description: "component and integration test patterns"
---

Keep the document under 500 lines. Use bullet lists for structure, code
snippets for pattern examples, and a Mermaid `flowchart` for the
architecture diagram.
