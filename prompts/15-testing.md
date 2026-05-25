---
id: testing
title: "Testing"
kind: testing
description: "Document testing strategy, infrastructure, patterns, and conventions."
tags: [testing, unit-tests, integration-tests, test-patterns, ci, coverage]
sources:
  - id: coding-patterns
    relation: companion
    path: coding-patterns.md
    description: "project conventions that also apply to test code"
  - id: architecture
    relation: prerequisite
    path: architecture.md
    description: "component boundaries that define test seams"
  - id: modules
    relation: companion
    path: modules/
    description: "unit under test for module-level specs"
---

# Testing

You are documenting how the currently open project is tested so that a future
LLM coding agent can write tests that match the existing style, use the right
infrastructure, and actually pass in CI.

An AI agent that creates a PR without proper tests will get it rejected. This
document ensures that doesn't happen.

## Steps

1. **Test stack and tooling**
   - Test runner(s): Jest, Vitest, pytest, Go testing, JUnit…
   - Assertion library: built-in, Chai, AssertJ…
   - Mocking library: jest.mock, sinon, testdouble, gomock, mockito…
   - Coverage tool and threshold (if enforced in CI).
   - Config file locations (jest.config, vitest.config, pytest.ini, etc.).

2. **Test directory structure**
   - Where do test files live? (co-located, `__tests__/`, `test/`, `spec/`)
   - Naming convention: `*.test.ts`, `*_test.go`, `test_*.py`, `*Spec.java`…
   - How are test utilities, helpers, and shared fixtures organized?

3. **Test categories and when to use each**
   - **Unit tests**: what counts as a unit here? How isolated? What to mock.
   - **Integration tests**: what do they exercise? Real DB, real HTTP, or
     faked? How to set up / tear down.
   - **E2E tests**: tool (Playwright, Cypress, Supertest…), scope, where they
     run (CI only? locally?).
   - **Contract / API tests**: do they exist? Pact, Dredd, schema validation?

4. **Mocking and stubbing patterns**
   - How are external services mocked? (fixtures, MSW, nock, WireMock,
     docker-compose, test containers)
   - How are database interactions handled in tests? (in-memory DB, test
     transactions rolled back, seeded test DB, repository mocks)
   - Dependency injection or module mocking — which pattern does this project
     prefer?

5. **Test data and factories**
   - Are there factory functions or fixtures for creating test entities?
     (factory-bot style, builders, seed files)
   - Where do they live? How are they used?
   - Naming conventions for test data.

6. **Standard test patterns**
   - Show 2–3 representative examples of how a typical test is structured in
     this project. Include:
     - A unit test (mocked dependencies)
     - An integration test (real infrastructure)
     - An API / endpoint test if applicable
   - Use actual file paths and function names from the repo.

7. **Running tests locally**
   - Commands to run: all tests, a single file, a single test, watch mode.
   - Required setup before running tests (env vars, DB, docker services).
   - Environment variables specific to the test environment.

8. **CI test behavior**
   - Which tests run on PR vs. merge vs. nightly?
   - Parallelization, sharding, retry-on-flake settings.
   - Known flaky tests or test-related tech debt.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (test runner config, representative test files quoted as patterns,
fixture/factory files, test helpers). Emit them in the `code_refs:` block
of the output frontmatter so an agent reading this doc can fetch them via
`read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/testing.md` using this
frontmatter (fill in `title` and `tags` from what you find):

---
id: testing
title: "Testing"
kind: testing
tags: []
code_refs:
  # Runner config, representative tests, fixtures/factories, helpers.
  # An agent can fetch each via read_source_file({ repo, path }). `repo`
  # is the source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <test name or symbol>
    description: <pattern this file illustrates>
sources:
  - id: coding-patterns
    relation: companion
    path: coding-patterns.md
    description: "project conventions that also apply to test code"
  - id: architecture
    relation: prerequisite
    path: architecture.md
    description: "component boundaries that define test seams"
---

Keep the document under 500 lines. Include actual code snippets from the repo
for the pattern examples — these are the most valuable part of the document
for an AI agent that needs to write tests.
