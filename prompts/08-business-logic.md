---
id: business-logic
title: "Business Logic"
kind: business-logic
description: "Capture core business logic rules, validation, and domain decisions."
tags: [business-logic, domain, rules, validation, state-machine, decisions]
sources:
  - id: data-model
    relation: prerequisite
    path: data-model.md
    description: "entities the rules operate on"
  - id: permissions
    relation: companion
    path: permissions.md
    description: "who may trigger each rule or state transition"
  - id: errors
    relation: companion
    path: errors.md
    description: "how rule violations are surfaced"
  - id: testing
    relation: companion
    path: testing.md
    description: "how business rules are verified"
args:
  DOMAIN_AREA:
    description: "Specific business area to focus on (e.g. 'billing', 'onboarding'). Omit for a full sweep."
    required: false
---

# Business logic

You are documenting the business rules embedded in the currently open project
so that a future LLM coding agent can implement features and fix bugs without
accidentally violating domain constraints.

Business rules are the "why" behind the code. They are the constraints,
validations, state machines, and decision trees that exist because of
real-world requirements — not because of technical choices.

## Steps

1. **Identify domain entities and their lifecycles**
   - What are the core business objects? (User, Order, Invoice, Subscription,
     Claim, etc.)
   - For each: draw the state machine — which states exist, which transitions
     are legal, and what triggers each transition.
   - Use Mermaid `stateDiagram-v2` for visual clarity.

2. **Validation rules**
   - Input validation: what constraints exist on user-facing fields?
     (format, length, uniqueness, allowed values)
   - Domain validation: what business-level checks run before an action is
     allowed? (e.g. "cannot cancel an order that has already shipped")
   - Where in the code do these live? (middleware, service layer, DB
     constraints, frontend)

3. **Calculations and formulas**
   - Pricing, tax, discounts, scoring, ranking — anything computed.
   - Document the formula, its inputs, and any rounding or precision rules.
   - Note where the source-of-truth logic lives (which file/function).

4. **Decision trees and conditional behavior**
   - Feature flags, A/B tests, plan-based feature gating.
   - Region- or locale-specific behavior.
   - Time-dependent rules (grace periods, trial expirations, SLAs).

5. **Invariants and constraints**
   - Hard rules the system must never violate (e.g. "account balance never
     goes negative", "one active subscription per user").
   - Where are these enforced? (application code, DB constraint, both?)

6. **Edge cases and known exceptions**
   - Grandfathered accounts, manual overrides, admin-only escapes.
   - Documented workarounds or tech-debt notes.

7. **Regulatory / compliance drivers**
   - Rules that exist because of GDPR, PCI-DSS, HIPAA, SOX, local law, etc.
   - Link to the requirement if documented.

## Source-file references

While documenting, note the repo-relative path of every source file that
owns a rule, validation, state machine, or invariant you describe. Emit
them in the `code_refs:` block of the output frontmatter so an agent
reading this doc can fetch them via `read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/business-logic.md` using
this frontmatter (fill in `title` and `tags` from what you find):

---
id: business-logic
title: "Business Logic"
kind: business-logic
tags: []
code_refs:
  # Files that own a rule, validation, state machine, or invariant. An
  # agent can fetch each via read_source_file({ repo, path }). `repo` is
  # the source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <rule or function name>
    description: <which rule or invariant this file enforces>
sources:
  - id: data-model
    relation: prerequisite
    path: data-model.md
    description: "entities the rules operate on"
  - id: permissions
    relation: companion
    path: permissions.md
    description: "who may trigger each rule or state transition"
  - id: errors
    relation: companion
    path: errors.md
    description: "how rule violations are surfaced"
  - id: testing
    relation: companion
    path: testing.md
    description: "how business rules are verified"
---

Keep the document under 500 lines. Use state diagrams for lifecycles and
tables for validation rules.
