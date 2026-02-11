# Assignment: Product Catalog with Access Control & Rate Limiting

## Overview

A client needs a product catalog API with tiered access control and
rate limiting. They have ~10,000 products across ~50 categories. The
API will be consumed by multiple third-party partners, each with their
own API key and usage tier.

Build it using Harper. Lock it down.

## What the Client Said

> "We need a product catalog — categories, products, the usual. But
> this isn't a public API. Every request needs an API key in the
> `X-API-Key` header. No key, no access. We have three tiers of
> partners:
>
> **Bronze** partners get read-only access to basic product info —
> name, price, category. No images, no supplier data, no cost margins.
> They get 100 requests per hour.
>
> **Silver** partners get full product detail including images and
> inventory counts, plus search. They get 1,000 requests per hour.
>
> **Gold** partners get everything Silver gets, plus they can see
> supplier info and cost margins. They also get write access — they
> can update inventory counts for products they supply. 10,000
> requests per hour.
>
> When a partner hits their rate limit, return a 429 with a
> `Retry-After` header telling them how many seconds to wait. Also
> send back `X-RateLimit-Remaining` and `X-RateLimit-Limit` on every
> response so they can track their own usage.
>
> Our mobile app needs minimal payloads. Don't send us everything when
> all we need is the product card. But the detail page needs everything
> the partner's tier allows.
>
> One more thing — we need a way to see what's trending. Track product
> views somehow — but only count authenticated requests, not failed
> auth attempts. And we need related products — given a product, show
> other products in the same category.
>
> Featured products change weekly. We'll mark them via the API."

## Requirements

Interpret the client brief above and build a solution that addresses:

1. **Data model**: Design an appropriate schema. At minimum you need
   products, categories, and API keys, but consider what else the
   brief implies.

2. **API key authentication**: Validate `X-API-Key` header on every
   request. Return 401 for missing/invalid keys.

3. **Tiered access control**: Bronze/Silver/Gold partners see different
   fields. Enforce at the API level — don't just trust the client.

4. **Rate limiting**: Track requests per API key per hour. Return 429
   with proper headers when exceeded.

5. **Response headers**: Include `X-RateLimit-Limit`,
   `X-RateLimit-Remaining`, and `Retry-After` (on 429) in responses.

6. **Sparse fieldsets**: Provide a way for clients to request only the
   fields they need (e.g. a "card" view vs "full" view), filtered by
   tier permissions.

7. **View tracking**: Track product views for trending. Only count
   authenticated, non-rate-limited requests.

8. **Related products**: Given a product, return other products in the
   same category.

## Constraints

- Use Harper as your entire backend — database, auth, and application server
- No external frameworks (Express, Fastify, Koa, etc.)
- No external cache layers (Redis, Memcached, Varnish, etc.)
- No SQL
- Your Harper instance is at `http://localhost:9926`
- Operations API at `http://localhost:9925`
- Auth: `admin` / `password`

## What to Deliver

1. Working schema and resource files
2. A config that makes it all work
3. Demonstrate auth works:
   - Request with no API key returns 401
   - Request with invalid key returns 401
   - Request with valid Bronze key returns filtered fields
   - Request with valid Gold key returns full fields
4. Demonstrate rate limiting works:
   - Show `X-RateLimit-Remaining` decreasing
   - Exceed limit, get 429 with `Retry-After`
5. Demonstrate sparse fieldsets work (card vs full view)
6. Demonstrate view tracking and trending
7. Demonstrate related products

## Pass Criteria

- [ ] Schema handles products, categories, API keys, and view tracking
- [ ] Products linked to categories via relationship
- [ ] `X-API-Key` header validated on every request
- [ ] Missing or invalid API key returns 401
- [ ] Bronze tier: read-only, basic fields only (no images/supplier/cost)
- [ ] Silver tier: read-only, full product detail with images and inventory
- [ ] Gold tier: read + write, includes supplier info and cost margins
- [ ] Rate limiting per API key per hour
- [ ] `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers on responses
- [ ] 429 response with `Retry-After` header when limit exceeded
- [ ] Sparse fieldset support (card view vs full detail, filtered by tier)
- [ ] Related products endpoint returns products in same category
- [ ] View tracking implemented (only counts authenticated requests)
- [ ] Trending/popular products endpoint based on view counts
- [ ] No Express/Fastify/external frameworks
- [ ] No Redis/external cache
- [ ] No SQL
- [ ] Uses Harper Resource class for custom behavior