---
id: events
title: "Events"
kind: events
description: "Catalog the event-driven architecture: topics, schemas, producers, and consumers."
tags: [events, messaging, kafka, pubsub, producers, consumers, schemas]
sources:
  - id: data-flows
    relation: companion
    path: flows/
    description: "flows that are driven or triggered by events"
  - id: integrations
    relation: companion
    path: integrations.md
    description: "external systems producing or consuming events"
  - id: errors
    relation: companion
    path: errors.md
    description: "dead-letter handling and event processing failures"
  - id: observability
    relation: companion
    path: observability.md
    description: "how to trace and monitor event pipelines"
---

# Events

You are documenting the event-driven parts of the currently open project —
message queues, pub/sub topics, webhooks, and domain events — so that a
future LLM coding agent knows what events exist, their schemas, and who
produces/consumes them.

In microservices architectures, events are often the primary integration
mechanism. Getting an event schema or topic name wrong can cause silent
data loss or downstream failures.

## Steps

1. **Messaging infrastructure**
   - What broker(s) are used? (Kafka, RabbitMQ, SQS, Redis Streams, NATS,
     Google Pub/Sub, in-process event bus…)
   - Connection config: where is it configured? Any shared connection pools?

2. **Event catalog**
   - For each event/message type, document:

   | Field          | What to capture                                         |
   |----------------|---------------------------------------------------------|
   | Event name     | Topic, queue, or event type string                      |
   | Schema         | TypeScript interface, JSON Schema, Avro, or Protobuf    |
   | Producer(s)    | Which service/module publishes this event                |
   | Consumer(s)    | Which service/module subscribes                         |
   | Trigger        | What causes the event to be published                   |
   | Ordering       | Is ordering guaranteed? Partition key?                   |
   | Idempotency    | How do consumers handle duplicates?                     |
   | Retry policy   | Max retries, backoff, dead-letter queue                  |

3. **Event flow diagram**
   - Produce a Mermaid diagram showing producers, topics/queues, and
     consumers with labeled edges.

4. **Domain events vs. integration events**
   - Does the project distinguish between internal domain events (within a
     bounded context) and integration events (across services)?
   - Where is each type defined?

5. **Schema evolution**
   - How are event schemas versioned? (schema registry, manual, none)
   - Forward/backward compatibility rules.
   - What happens when a consumer sees an unknown field?

6. **Distributed consistency patterns**
   - How does the system maintain consistency across services?
   - Patterns in use: saga (orchestrated or choreographed?), outbox pattern,
     change data capture, dual writes, none (accept eventual inconsistency)?
   - For each saga or multi-step flow:
     - What are the compensation / rollback steps if a step fails?
     - Is there a reconciliation job that detects and fixes drift?
   - Idempotency guarantees: can the full flow be safely retried end-to-end?

7. **Dead-letter queues and poison messages**
   - Where do failed messages end up?
   - How are they monitored and replayed?

8. **Webhooks (inbound and outbound)**
   - Webhooks this project receives from external services.
   - Webhooks this project sends to customers or partners.
   - Signature verification, retry logic.

## Source-file references

While documenting, note the repo-relative path of every source file you
cite (event schemas, producer code, consumer/handler code, dead-letter
config, webhook signature verifiers). Emit them in the `code_refs:` block
of the output frontmatter so an agent reading this doc can fetch them via
`read_source_file({ repo, path })`.

## Output

Write the result as a Markdown file to `agent-docs/events.md` using this
frontmatter (fill in `title` and `tags` from what you find):

---
id: events
title: "Events"
kind: events
tags: []
code_refs:
  # Schemas, producers, consumers, dead-letter setup, webhook handlers.
  # An agent can fetch each via read_source_file({ repo, path }). `repo`
  # is the source-root name from list_source_roots.
  - repo: <source-root name>
    path: <relative/path/to/file.ext>
    ref: <event or handler name>
    description: <producer / consumer / schema for which event>
sources:
  - id: integrations
    relation: companion
    path: integrations.md
    description: "external systems producing or consuming events"
  - id: errors
    relation: companion
    path: errors.md
    description: "dead-letter handling and event processing failures"
  - id: observability
    relation: companion
    path: observability.md
    description: "how to trace and monitor event pipelines"
---

Keep the document under 500 lines. Use the table format above for the event
catalog and a Mermaid diagram for the topology.
