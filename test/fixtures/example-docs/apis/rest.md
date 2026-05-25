---
id: apis/rest
title: REST API
kind: api
tags: [rest, api]
api_kind: rest
---

# REST API

The shopcart HTTP surface. All endpoints require a valid JWT in the
`Authorization` header; unauthenticated requests return 401.

## Endpoints

| Method | Path                | Description                                |
| ------ | ------------------- | ------------------------------------------ |
| GET    | `/api/products`     | List products.                             |
| POST   | `/api/cart`         | Create or update the active cart.          |
| POST   | `/api/checkout`     | Begin a checkout; returns a Stripe secret. |
| GET    | `/api/orders/:id`   | Look up a single order.                    |

The `POST /api/checkout` endpoint is the entry point of the checkout
flow documented in `flows/checkout.md`.
