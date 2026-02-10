# Assignment: Product Catalog with Caching & Performance

## Overview

A client needs a product catalog API that can handle high read traffic with
minimal database load. They have ~10,000 products across ~50 categories.
Most traffic is reads (browse/search), with occasional writes (admin updates).

Build it using Harper. Make it fast.

## What the Client Said

> "We need a product catalog. Categories, products, the usual. But our
> previous system fell over at 500 concurrent readers because every
> request hit the database. We need caching — proper caching with
> ETags, conditional requests, the works. Also, some products are
> featured and those change weekly. Oh, and we need a way to see
> what's trending — track product views somehow.
>
> Our mobile app needs minimal payloads. Don't send us everything when
> all we need is the product card. But the detail page needs everything
> including related products from the same category.
>
> One more thing — when an admin updates a product, the cache needs to
> reflect the change. We can't have stale data for more than a few
> seconds."

## Requirements

Interpret the client brief above and build a solution that addresses:

1. **Data model**: Design an appropriate schema. At minimum you need
   products and categories, but consider what else the brief implies.

2. **Caching strategy**: Implement caching that reduces database load
   for read-heavy traffic. Use Harper's built-in capabilities — do not
   add Redis, Varnish, or any external cache layer.

3. **Conditional requests**: Support ETags and/or Last-Modified headers
   so clients can avoid re-downloading unchanged data.

4. **Sparse fieldsets**: Provide a way for clients to request only the
   fields they need (e.g. a "card" view vs "full" view).

5. **Cache invalidation**: When a product is updated, ensure subsequent
   reads reflect the change promptly.

6. **View tracking**: Track product views for trending. This should not
   slow down the read path.

7. **Related products**: Given a product, return other products in the
   same category.

## Constraints

- Use Harper as your entire backend — database, cache, and application server
- No external frameworks (Express, Fastify, Koa, etc.)
- No external cache layers (Redis, Memcached, Varnish, etc.)
- No SQL
- Your Harper instance is at `http://localhost:9926`
- Operations API at `http://localhost:9925`
- Auth: `admin` / `password`

## What to Deliver

1. Working schema and resource files
2. A config that makes it all work
3. Demonstrate the caching works:
   - First request returns full response with ETag
   - Second request with If-None-Match returns 304
   - Update the product, repeat — should get 200 with new ETag
4. Demonstrate sparse fieldsets work (card vs full view)
5. Demonstrate view tracking and trending
6. Demonstrate related products
7. Demonstrate cache invalidation after an update

## Pass Criteria

- [ ] Schema handles products, categories, and view tracking
- [ ] Products linked to categories via relationship
- [ ] GET product returns ETag or Last-Modified header
- [ ] Conditional GET with matching ETag returns 304 Not Modified
- [ ] After product update, conditional GET returns 200 with new data
- [ ] Sparse fieldset support (card view vs full detail)
- [ ] Related products endpoint returns products in same category
- [ ] View tracking implemented without slowing reads
- [ ] Trending/popular products endpoint based on view counts
- [ ] Cache invalidation works — updates reflect within seconds
- [ ] No Express/Fastify/external frameworks
- [ ] No Redis/external cache
- [ ] No SQL
- [ ] Uses Harper Resource class for custom behavior
