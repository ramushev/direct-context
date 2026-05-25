---
id: data-model
title: "Data Model"
kind: data-model
description: "Document the data model: schemas, relationships, and migration patterns."
tags: [data-model, schema, database, migrations, entities, relationships]
sources:
  - id: business-logic
    relation: prerequisite
    path: business-logic.md
    description: "rules that constrain the data model"
  - id: data-flows
    relation: companion
    path: flows/
    description: "how data is read and written end-to-end"
  - id: coding-patterns
    relation: companion
    path: coding-patterns.md
    description: "migration and query conventions used in this project"
args:
  STORE_NAME:
    description: "Name of the data store to document (e.g. 'postgres-main', 'redis-cache'). Omit to document all."
    required: false
---

# Data model

You are documenting the data model of the currently open project so that a
future LLM coding agent can write correct queries, add fields, create
migrations, and understand entity relationships without reverse-engineering
the schema.

## Steps

1. **Identify all data stores**
   - Relational databases (Postgres, MySQL, SQLite…)
   - Document stores (MongoDB, DynamoDB, Firestore…)
   - Caches (Redis, Memcached…)
   - Search indices (Elasticsearch, Typesense…)
   - File/object storage (S3, local disk…)
   - List each with: name, technology, purpose (1 sentence).

2. **Schema inventory**
   - For **relational DBs**: list every table/view with columns, types,
     nullability, defaults, and constraints (PK, FK, unique, check).
   - For **document stores**: list collections with a representative document
     shape (TypeScript interface or JSON example).
   - For **caches**: key naming convention, TTL policy, value shape.
   - For **search indices**: index name, mapping/schema, what populates it.

3. **Entity-relationship diagram**
   - Produce a Mermaid `erDiagram` showing entities, their key fields, and
     relationships (1:1, 1:N, M:N).
   - Include join/pivot tables.

4. **Migration strategy**
   - What tool manages migrations? (Knex, Prisma, Alembic, Flyway, raw SQL…)
   - Where do migration files live?
   - Naming convention and ordering (timestamps? sequential numbers?).
   - Any special patterns: zero-downtime migrations, expand-contract, etc.

5. **Seeding & fixtures**
   - How is the DB seeded for development or testing?
   - Where are seed/fixture files?

6. **Soft deletes, timestamps, and audit columns**
   - Does the project use `deleted_at`, `created_at`, `updated_at`?
   - Any audit trail or history tables?

7. **Cross-service data ownership**
   - In a microservices setup: which service owns which tables?
   - Are there shared databases? Read replicas other services query?

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (model/entity definitions, schema files, migrations, seed files).
Emit them in the `code_refs:` block of the output frontmatter so an agent
reading this doc can fetch them via `read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/data-model.md` using this
frontmatter (fill in `title` and `tags` from what you find):

---
id: data-model
title: "Data Model"
kind: data-model
tags: []
code_refs:
  # Model/entity definitions, schema files, migrations, seed files. An
  # agent can fetch each via read_source_file({ repo, path }). `repo` is
  # the source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <entity or table name>
    description: <what this file defines>
sources:
  - id: business-logic
    relation: prerequisite
    path: business-logic.md
    description: "rules that constrain the data model"
  - id: coding-patterns
    relation: companion
    path: coding-patterns.md
    description: "migration and query conventions used in this project"
---

Keep the document under 500 lines. Use tables for column listings and a
Mermaid ER diagram for relationships.
