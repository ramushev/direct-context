---
id: deployment
title: "Deployment"
kind: deployment
description: "Document CI/CD pipeline, deployment process, and environment configuration."
tags: [deployment, ci-cd, pipeline, environments, release, configuration]
sources:
  - id: testing
    relation: companion
    path: testing.md
    description: "what the CI pipeline runs before deploying"
  - id: observability
    relation: companion
    path: observability.md
    description: "what to watch after a deploy"
  - id: runtime-behavior
    relation: companion
    path: runtime-behavior.md
    description: "what the deployed process does at startup"
---

# Deployment

You are documenting how the currently open project is built, tested, and
deployed so that a future LLM coding agent understands the full path from
"code merged" to "running in production" — and can create PRs that pass CI,
follow release conventions, and avoid deployment pitfalls.

## Steps

1. **CI pipeline**
   - Where is CI configured? (`.github/workflows/`, `.gitlab-ci.yml`,
     `Jenkinsfile`, `circle.yml`, etc.)
   - What runs on every PR? (lint, typecheck, unit tests, integration tests,
     build, security scan)
   - What runs on merge to main? (deploy, publish, release)
   - Typical CI duration.

2. **Branch and PR conventions**
   - Branch naming convention (e.g. `feat/`, `fix/`, `chore/`).
   - PR title format (conventional commits?).
   - Required reviewers, auto-merge rules.
   - Merge strategy: squash, merge commit, rebase.

3. **Build process**
   - Build command(s) and output artifacts.
   - Docker: Dockerfile location, base image, multi-stage build?
   - Asset compilation, bundling, tree-shaking — anything notable.

4. **Environments**
   - List all environments (local, dev, staging, production, preview…).
   - How do they differ? (feature flags, data, scale, external
     dependencies)
   - Environment-specific config: how is it managed? (env vars, config
     files, secrets manager, Helm values)

5. **Deployment mechanism**
   - How is the code deployed? (Kubernetes rollout, serverless deploy, rsync,
     Vercel push, Terraform apply…)
   - Blue-green, canary, rolling update, or big-bang?
   - Who/what triggers a deploy? (CI auto-deploy, manual approval, chatbot)

6. **Database migrations in deployment**
   - When do migrations run relative to the code deploy?
   - Rollback strategy for failed migrations.

7. **Feature flags and gradual rollout**
   - Feature flag system (LaunchDarkly, Unleash, custom, env var…).
   - How to add a new flag, toggle it, and clean it up.

8. **Multi-service deployment coordination**
   - When a change spans multiple services (e.g. new event producer +
     consumer, or a schema migration that affects 3 services):
     - What order do you deploy?
     - How do you ensure backward compatibility during the rollout window?
     - Is there a deploy orchestration tool, or is it manual sequencing?
   - Expand-contract pattern: does the team use it? Document the steps.
   - Are there examples of past multi-service rollouts to reference?

9. **Hotfix and emergency deploy**
   - Fast-track process for critical fixes (security, data loss, outage).
   - Can you skip staging? Who approves?
   - How is a hotfix branch created and deployed?

10. **Rollback and incident response**
   - How to roll back a bad deploy.
   - Monitoring checks that gate a rollout (error rate, latency).
   - On-call and escalation pointers (if documented in repo).
   - Correlation: how to link a deploy to a change in behavior (deploy
     tags, commit SHA in metrics, deploy log).

11. **Release versioning**
   - Versioning scheme (semver, calver, commit SHA, none).
   - Changelog generation, release notes, tagging.

12. **Pipeline diagram**
    - Produce a Mermaid `flowchart` showing the path from "PR opened"
      through CI stages (lint, typecheck, test, build) → merge → deploy
      mechanism → each environment (dev, staging, prod). Label each
      edge with the trigger (auto, manual approval, merge to main).
      Goal: a one-screen mental map of the release flow.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (CI workflow files, Dockerfile, deploy manifests, release scripts,
migration runner config, feature-flag setup). Emit them in the
`code_refs:` block of the output frontmatter so an agent reading this doc
can fetch them via `read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/deployment.md` using this
frontmatter (fill in `title` and `tags` from what you find):

---
id: deployment
title: "Deployment"
kind: deployment
tags: []
code_refs:
  # CI workflow files, Dockerfile, deploy manifests, release/migration
  # scripts, feature-flag setup. An agent can fetch each via
  # read_source_file({ repo, path }). `repo` is the source-root name from
  # list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <job or step name>
    description: <what this file controls>
sources:
  - id: testing
    relation: companion
    path: testing.md
    description: "what the CI pipeline runs before deploying"
  - id: observability
    relation: companion
    path: observability.md
    description: "what to watch after a deploy"
  - id: runtime-behavior
    relation: companion
    path: runtime-behavior.md
    description: "what the deployed process does at startup"
---

Keep the document under 500 lines. Use bullet lists and short
paragraphs, plus a Mermaid `flowchart` for the pipeline diagram.
