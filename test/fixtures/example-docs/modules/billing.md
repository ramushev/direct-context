---
id: modules/billing
title: Billing
kind: module
tags: [billing, payments]
source: src/billing
---

# Billing

The Billing module owns every interaction with Stripe. It creates a Stripe
PaymentIntent during checkout, listens for webhook events, and reconciles
the local order state against the payment intent status.

## Stripe integration

- `createPaymentIntent(order)` — turns a cart into a Stripe payment intent
  with the order id stored in `metadata`.
- `handleWebhook(event)` — verifies the Stripe signature and routes
  `payment_intent.succeeded` / `payment_intent.payment_failed` events to
  the order state machine.

## Key files

- `src/billing/stripe.ts` — Stripe client wrapper
- `src/billing/webhooks.ts` — webhook handler
- `src/billing/reconcile.ts` — periodic reconciliation job
