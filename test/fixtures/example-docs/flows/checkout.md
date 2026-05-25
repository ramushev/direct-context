---
id: flows/checkout
title: Checkout flow
kind: flow
tags: [checkout, payments]
entrypoint: POST /api/checkout
---

# Checkout flow

End-to-end trace of a user completing a checkout in shopcart, from the
cart submission through the Stripe payment intent confirmation.

```mermaid
sequenceDiagram
    participant U as User
    participant API as shopcart API
    participant DB as PostgreSQL
    participant S as Stripe
    U->>API: POST /api/checkout (cart)
    API->>DB: INSERT order (status=pending)
    API->>S: create PaymentIntent
    S-->>API: client_secret
    API-->>U: client_secret
    U->>S: confirm payment (Stripe.js)
    S-->>API: webhook payment_intent.succeeded
    API->>DB: UPDATE order (status=paid)
```

## Steps

1. Client posts the cart to `POST /api/checkout`.
2. API writes a `pending` order row.
3. API asks the billing module to create a Stripe payment intent.
4. Client confirms the payment intent via Stripe.js.
5. Stripe sends a webhook; the billing module marks the order paid.
