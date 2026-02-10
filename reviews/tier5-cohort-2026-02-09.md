# Tier 5 Cohort Review: 2026-02-09

## Run Parameters

| Parameter | Value |
|-----------|-------|
| Tier | 5 — Caching, ETags & Performance |
| Assignment | tier-5-product-catalog.md |
| Harper Image | harperdb:v5-local |
| Expert Iteration | 0 (no expert hints) |
| Workers | 3 |
| Convoy | hq-cv-fegte |

## Result: 2/3 PASS, 1/3 FAIL

**First failure in the DX Lab.** Worker 1 (furiosa) did not implement ETags, conditional requests, or cache invalidation — 4 of 14 pass criteria missed. Workers 2 and 3 both implemented full ETag/304 support with cache invalidation.

## Workers

| Worker | Polecat | Bead | Time | Result |
|--------|---------|------|------|--------|
| 1 | furiosa | dl-3lp9 | ~10 min | **FAIL** |
| 2 | nux | dl-m3y8 | ~21 min | PASS |
| 3 | slit | dl-8hg4 | ~21 min | PASS |

**Notable:** The fastest worker failed. furiosa finished in 10 min — half the time of the others — because it skipped the hardest part of the assignment (caching/ETags). Speed without completeness is a false signal.

## Timeline

- 17:55 — Docker stacks created, beads slung, convoy hq-cv-fegte tracking
- 18:05 — furiosa (W1) completes `gt done` (~10 min) — **missing ETags**
- 18:16 — nux (W2) and slit (W3) complete `gt done` (~21 min each)
- 18:16 — Convoy 3/3 COMPLETE

## Pass Criteria

| Criterion | W1 | W2 | W3 |
|-----------|:--:|:--:|:--:|
| Schema handles products, categories, and view tracking | Y | Y | Y |
| Products linked to categories via relationship | Y | Y | Y |
| GET product returns ETag or Last-Modified header | **N** | Y | Y |
| Conditional GET with matching ETag returns 304 | **N** | Y | Y |
| After product update, conditional GET returns 200 with new data | **N** | Y | Y |
| Sparse fieldset support (card view vs full detail) | Y | Y | Y |
| Related products endpoint returns products in same category | Y | Y | Y |
| View tracking implemented without slowing reads | Y | Y | ~Y |
| Trending/popular products endpoint based on view counts | Y | Y | Y |
| Cache invalidation works — updates reflect within seconds | **N** | Y | Y |
| No Express/Fastify/external frameworks | Y | Y | Y |
| No Redis/external cache | Y | Y | Y |
| No SQL | Y | Y | Y |
| Uses Harper Resource class for custom behavior | Y | Y | Y |

### Worker 1 Failure Analysis

furiosa completely skipped the caching/ETag requirements. No `ETag` header is ever set, no `If-None-Match` is ever read, no 304 is ever returned. The `resources.js` has no reference to headers, context, caching, or ETags at all. This isn't a partial implementation — it's a complete omission.

**Root cause hypothesis:** The assignment uses a "client brief" format with requirements embedded in a quote block. The caching/ETag requirements are in the client quote and then referenced more formally in the numbered requirements list. furiosa may have focused on the numbered list (data model, sparse fieldsets, view tracking, related products) and not fully processed the ETag/conditional request requirements, or didn't know how to access HTTP headers in Harper Resource classes and moved on.

**W3 view tracking caveat:** slit's `trackView()` is `await`ed (not fire-and-forget), which technically slows reads. The assignment says "should not slow down the read path." However, the write is a single DB operation and fast enough that it's a borderline call. Marked as ~Y.

## Schema Analysis

### Worker 1 (furiosa)
```graphql
type Category @table @export {
  id: ID @primaryKey
  name: String @indexed
  description: String
  slug: String @indexed
  products: [Product] @relationship(to: categoryId)
  createdAt: Float @createdTime
  updatedAt: Float @updatedTime
}

type Product @table @export {
  id: ID @primaryKey
  name: String @indexed
  description: String
  price: Float
  sku: String @indexed
  imageUrl: String
  featured: Boolean @indexed
  categoryId: ID @indexed
  category: Category @relationship(from: categoryId)
  tags: [String] @indexed
  createdAt: Float @createdTime
  updatedAt: Float @updatedTime
}

type ProductView @table @export {
  id: ID @primaryKey
  productId: ID @indexed
  viewedAt: Float @createdTime
}
```

### Worker 2 (nux)
```graphql
type Category @table @export {
  id: ID @primaryKey
  name: String @indexed
  slug: String @indexed
  description: String
  products: [Product] @relationship(to: categoryId)
  createdAt: Float @createdTime
  updatedAt: Float @updatedTime
}

type Product @table @export {
  id: ID @primaryKey
  name: String @indexed
  description: String
  price: Float
  imageUrl: String
  featured: Boolean @indexed
  categoryId: ID @indexed
  category: Category @relationship(from: categoryId)
  tags: [String]
  createdAt: Float @createdTime
  updatedAt: Float @updatedTime
}

type ProductView @table {
  id: ID @primaryKey
  productId: ID @indexed
  viewCount: Int @indexed
  lastViewedAt: Float
}
```

### Worker 3 (slit)
```graphql
type Category @table {
  id: ID @primaryKey
  name: String @indexed
  description: String
  products: [Product] @relationship(to: categoryId)
  createdAt: Long @createdTime
  updatedAt: Long @updatedTime
}

type Product @table {
  id: ID @primaryKey
  name: String @indexed
  description: String
  price: Float
  sku: String
  imageUrl: String
  featured: Boolean @indexed
  categoryId: ID @indexed
  category: Category @relationship(from: categoryId)
  viewCount: Int @indexed
  createdAt: Long @createdTime
  updatedAt: Long @updatedTime
}

type ProductView @table {
  id: ID @primaryKey
  productId: ID @indexed
  createdAt: Long @createdTime
}
```

### Schema Divergence

| Feature | W1 (furiosa) | W2 (nux) | W3 (slit) |
|---------|:---:|:---:|:---:|
| `@export` on tables | Yes (all) | Yes (Cat/Prod) | No |
| `slug` field on Category | **Yes** | **Yes** | No |
| `sku` field on Product | **Yes** | No | **Yes** |
| `tags` field on Product | Yes (@indexed) | Yes | No |
| `viewCount` on Product table | No | No | **Yes** |
| ProductView pattern | Individual records | Counter (id=productId) | Individual records |
| `@indexed` on viewCount | N/A | Yes (on ProductView) | Yes (on Product) |
| Timestamp type | Float | Float | Long |

**Key design decision: Where does viewCount live?**

- **W1 (furiosa):** viewCount doesn't exist as a field. Trending is computed by scanning all ProductView records and counting per productId. O(n) on every trending request.
- **W2 (nux):** viewCount lives on ProductView table as a counter. One ProductView record per product (id=productId). Trending queries ProductView sorted by viewCount. Product table stays clean.
- **W3 (slit):** viewCount lives **on the Product table itself**. ProductView records individual views AND increments Product.viewCount. Trending queries Product sorted by viewCount. Most efficient for reads but couples view tracking to the product record.

W3's approach is the most read-efficient (trending is just a sorted query on Product) but has a subtle problem: incrementing viewCount on Product changes `updatedAt`, which would invalidate ETags on every view. W3 solved this by computing ETags from content fields only, explicitly excluding viewCount and timestamps — a clever design.

W2's approach cleanly separates concerns — Product records don't change when viewed, so ETags naturally stay stable.

## Resources.js Analysis

### Architecture Comparison

| Aspect | W1 (furiosa) | W2 (nux) | W3 (slit) |
|--------|:---:|:---:|:---:|
| Resource classes exported | **5** | **2** | **2** |
| Lines of code | 147 | 217 | 209 |
| ETag support | **No** | Yes | Yes |
| Conditional 304 | **No** | Yes | Yes |
| Cache-Control header | **No** | Yes | No |
| `this.getContext()` used | No | Yes | Yes |
| `context.headers` read | No | Yes | Yes |
| `context.responseHeaders` set | No | No | **Yes** |
| View tracking pattern | Separate POST | Fire-and-forget | Awaited inline |
| Category validation | No | Yes | Yes |

### Worker 1 (furiosa) — Many Small Endpoints (FAIL)

**Pattern:** Five separate Resource classes, each handling one concern.

```js
export class Product extends tables.Product { ... }        // Main CRUD + ?view=card
export class ProductCard extends Resource { ... }           // Card view endpoint
export class ProductView extends tables.ProductView { ... } // View tracking
export class Trending extends Resource { ... }              // GET /Trending/
export class RelatedProducts extends Resource { ... }       // GET /RelatedProducts/<id>
```

- **Sparse fieldsets:** Dual approach — `?view=card` on Product.get() AND a separate `ProductCard` Resource class. Belt and suspenders.
- **View tracking:** Separate `POST /ProductView/` — client explicitly tracks views. Doesn't slow reads at all because it's a separate request.
- **Trending:** `GET /Trending/` — scans all ProductView records, counts per product, sorts, returns top 10.
- **Related:** `GET /RelatedProducts/<id>` — looks up product, scans all products filtering by matching categoryId.
- **Lines:** 147 (shortest)

**Strengths:** Clean separation of concerns, each endpoint does one thing, easy to understand.

**Critical weakness:** No caching, no ETags, no conditional requests, no `this.getContext()`. furiosa never accessed the HTTP request/response layer. This suggests the agent didn't know how to access headers in Harper's Resource class model — a documentation gap that became a failure.

### Worker 2 (nux) — Query Parameter Router (PASS)

**Pattern:** Two Resource classes. Product.get() routes by query params.

```js
export class Category extends tables.Category { ... }
export class Product extends tables.Product { ... }
```

All custom behavior is inside Product.get() via query parameter routing:
- `?trending=true&limit=10` → `this.getTrending(target)`
- `?relatedTo=<id>&limit=10` → `this.getRelated(relatedTo, target)`
- `?view=card` or `?view=full` → sparse fieldsets
- `?featured=true` → featured products filter
- Default single product → ETag + conditional request + view tracking

**ETag implementation:**
```js
function generateETag(record) {
    return `"${record.updatedAt || record.createdAt || Date.now()}"`;
}
```
Uses `updatedAt` timestamp as ETag value. Simple, effective. When product is updated, `updatedAt` changes → ETag changes → client gets 200 with new data.

**Conditional request:**
```js
const ifNoneMatch = context.headers?.get('if-none-match');
if (ifNoneMatch && ifNoneMatch === etag) {
    return { status: 304, headers: { 'ETag': etag, 'Cache-Control': 'max-age=60, must-revalidate' } };
}
```
Returns `{ status: 304, headers: {...} }` object — this is the Harper pattern for custom HTTP responses from Resource classes.

**View tracking:** Fire-and-forget: `this.trackView(record.id).catch(() => {})`. Increments counter on ProductView record (upsert pattern). Does NOT slow reads.

**Full view:** When `?view=full`, includes `relatedProducts` array inline with the product data. Smart — the client brief said "the detail page needs everything including related products."

**Cache-Control:** `max-age=60, must-revalidate` — tells clients to cache for 60 seconds then revalidate.

**Strengths:** Most complete implementation. Covers every requirement. Clean query parameter routing. Proper fire-and-forget view tracking. `limit` parameter on trending and related endpoints. Featured products filter (bonus).

### Worker 3 (slit) — Path-Based Router (PASS)

**Pattern:** Two Resource classes. Product.get() routes by URL path segments.

```js
export class Product extends tables.Product { ... }
export class Category extends tables.Category { ... }
```

Uses path-based routing:
- `/Product/trending` → `this.getTrending(target)`
- `/Product/{id}/related` → `this.getRelated(productId)`
- Default → ETag + conditional request + view tracking

**ETag implementation:**
```js
function computeETag(data) {
    let content;
    if (Array.isArray(data)) {
        content = data.map(extractContentFields);
    } else {
        content = extractContentFields(data);
    }
    const hash = crypto.createHash('md5').update(JSON.stringify(content)).digest('hex');
    return '"' + hash + '"';
}
```
Uses MD5 hash of content fields (excluding viewCount and timestamps). This is the most robust ETag strategy — it's content-based rather than timestamp-based. Works for both single records and collections.

**Conditional request:**
```js
const ifNoneMatch = context.headers.get('if-none-match');
if (ifNoneMatch && ifNoneMatch === etag) {
    return { status: 304, headers: { 'ETag': etag } };
}
```

**Response headers:** Uses `context.responseHeaders.set('ETag', etag)` — the only worker to use Harper's proper response header API. W2 returned the ETag in the response object; W3 also sets it on the context directly.

**View tracking:** `await this.trackView(result.id)` — awaited, not fire-and-forget. Records in ProductView AND increments Product.viewCount. This technically slows reads but the operations are fast.

**ETag vs viewCount design:** Since viewCount is on the Product table and gets incremented on every read, `updatedAt` would change constantly, making timestamp-based ETags useless. slit solved this by computing ETags from content fields only, explicitly excluding viewCount. This is architecturally sound — view tracking doesn't invalidate the cache.

**Target manipulation:** `target.delete('view')` removes custom query params before passing to `super.get()`, preventing Harper from trying to use them as filters. This is a defensive technique the other workers didn't use.

**Strengths:** Most robust ETag strategy (content hash, not timestamp). Proper response header API usage. Clever exclusion of viewCount from ETag computation. Path-based routing (`/Product/{id}/related`) is RESTful.

**Weakness:** View tracking is synchronous, slowing reads. Uses `tables.Product.put()` for viewCount increment, which writes the full record and could race with concurrent updates.

## The ETag Problem: Why Worker 1 Failed

This is the core finding of Tier 5. All 3 workers could model data, write Resource classes, and implement business logic (proven in Tiers 1-4). But only 2 of 3 could implement HTTP-layer behavior (ETags, conditional requests, response headers).

**What W2 and W3 knew that W1 didn't:**
1. `this.getContext()` returns the HTTP request context
2. `context.headers.get('if-none-match')` reads request headers
3. Returning `{ status: 304, headers: {...} }` controls the HTTP response
4. `context.responseHeaders.set()` sets response headers (W3 only)

**Where this knowledge comes from:** Harper's Resource class documentation. The fact that 2/3 agents found it means it IS documented, but it may not be prominent enough. furiosa either:
- Didn't search for caching/ETag docs
- Found the docs but couldn't understand how to apply them
- Decided to skip it due to complexity and time pressure

The 10-min completion time (vs 21 min for others) strongly suggests furiosa deprioritized the caching requirements rather than struggling with them.

## View Tracking Strategies

Three different approaches to "track product views without slowing reads":

| Strategy | W1 | W2 | W3 |
|----------|:--:|:--:|:--:|
| When tracked | Client POST | Inline on GET | Inline on GET |
| Async? | N/A (separate request) | Yes (fire-and-forget) | **No (awaited)** |
| Storage | Individual records | Counter (upsert) | Both (record + counter) |
| Read path impact | Zero | Zero | **~1-2ms per read** |
| Trending query cost | O(all views) | O(sorted query) | O(sorted query) |

**W1's approach** (separate POST) is the most architecturally clean for "not slowing reads" — views are tracked by a completely separate request. But it requires client cooperation.

**W2's approach** (fire-and-forget inline) is the best balance — transparent to the client, doesn't block the read response, upsert pattern keeps the counter table small.

**W3's approach** (awaited inline with dual write) is the least optimal — awaits two DB operations on every product GET. However, having viewCount directly on the Product table makes trending queries fastest.

## config.yaml

All 3 workers produced identical config.yaml:

```yaml
graphqlSchema:
  files: 'schema.graphql'

jsResource:
  files: 'resources.js'

rest: true
```

**100% config.yaml rate** — consistent with Tier 4. By Tier 5, config.yaml is muscle memory.

## Tier 5 vs Previous Tiers

| Metric | T1 | T2 | T3 | T4 | T5 |
|--------|:-:|:-:|:-:|:-:|:-:|
| Pass rate | 3/3 | 3/3 | 3/3 | 3/3 | **2/3** |
| Avg time (passing) | ~9m | ~8m | ~12m | ~16m | **~21m** |
| Files produced | 1 | 1 | 2-4 | 3-5 | **3** |
| Resource classes per worker | 0 | 0 | 2 | 2-3 | **2-5** |
| HTTP header manipulation | No | No | No | No | **Yes (2/3)** |
| Custom routing in get() | No | No | Yes | No | **Yes** |
| External imports | No | No | No | No | **Yes (crypto)** |
| Test scripts written | 0/3 | 0/3 | 0/3 | 3/3 | **0/3** |
| Expert interventions | 0 | 0 | 0 | 0 | **0** |
| Nudges required | 0 | 0 | 3 | 0 | **0** |

**First failure** — Tier 5 breaks the 100% streak. The assignment's ambiguity and lack of doc URLs worked as designed.

**No test scripts** — Unlike Tier 4 where all 3 wrote real-time test scripts, none wrote test scripts here. The assignment asked them to "demonstrate" caching but didn't trigger the same test-writing instinct as real-time MQTT/WebSocket.

**New capability unlocked:** `this.getContext()` for HTTP request/response manipulation. This is the first tier requiring agents to interact with the HTTP layer inside Resource classes.

## Architectural Patterns

### Endpoint Organization

| Pattern | Worker | Endpoints |
|---------|--------|-----------|
| Many small classes | W1 (furiosa) | Product, ProductCard, ProductView, Trending, RelatedProducts (5 classes) |
| Query param router | W2 (nux) | Category, Product (2 classes, Product handles trending/related/featured via `?param`) |
| Path-based router | W3 (slit) | Product, Category (2 classes, Product handles trending/related via URL path) |

W2 and W3 both consolidated everything into the Product Resource class using different routing strategies. W1 split into 5 separate endpoints. The consolidated approach is more typical of how Harper Resource classes are meant to be used — one class per table, with custom logic in the method overrides.

### Harper API Discovery

| API | W1 | W2 | W3 |
|-----|:--:|:--:|:--:|
| `this.getContext()` | N | Y | Y |
| `context.headers.get()` | N | Y | Y |
| `context.responseHeaders.set()` | N | N | Y |
| `target.get()` for query params | N | Y | Y |
| `target.has()` / `target.delete()` | N | N | Y |
| `tables.X.search({ sort, limit })` | N | Y | N |
| `extends Resource` (non-table) | Y | N | N |
| `crypto` import | N | N | Y |

W1 used `extends Resource` (not `extends tables.X`) for non-table endpoints — this is a valid Harper pattern for virtual endpoints that don't back to a table. The other workers didn't need it because they consolidated into table-backed classes.

W3 discovered the most Harper APIs — including the `target.has()`/`target.delete()` manipulation and `context.responseHeaders.set()`.

## Doc Gaps Identified

1. **`this.getContext()` and HTTP headers.** The critical gap that caused W1's failure. How to read request headers and set response headers from within a Resource class needs to be more prominent in the docs — perhaps a dedicated "HTTP Caching in Resource Classes" example.

2. **Custom response format `{ status, headers, data }`.** W2 and W3 both returned objects with `status: 304` and `headers` — this pattern for controlling HTTP responses from Resource classes should be explicitly documented.

3. **`context.responseHeaders`** vs returning headers in the response object. W3 used both patterns. Which is canonical? Are they equivalent?

4. **`target.get()`, `target.has()`, `target.delete()`.** The request target's URLSearchParams-like API. W3 discovered and used all three methods; W2 used `get()` only. This API needs documentation.

5. **`tables.X.search({ sort, limit })`.** W2 used sort and limit options in search. This advanced query capability should be documented alongside the basic conditions-only pattern.

6. **`extends Resource` for virtual endpoints.** W1 used this for endpoints without a backing table (Trending, RelatedProducts, ProductCard). This pattern is useful but undocumented — when should you extend `Resource` vs `tables.X`?

## Recommendations

1. **Tier 5 produces the first meaningful differentiation.** 2/3 pass rate shows this tier successfully identifies agents that can't handle HTTP-layer integration. This is a good difficulty calibration — harder than Tier 4 but not impossible.

2. **The ETag failure is a doc problem, not an intelligence problem.** furiosa demonstrated competent Resource class usage, schema design, and business logic. The failure was specifically on discovering `this.getContext()` and the HTTP header API. Better docs or a brief mention of `getContext()` in the assignment would likely fix this.

3. **Add "HTTP headers in Resource classes" to the Harper docs.** A small example showing `this.getContext()`, reading `If-None-Match`, and returning `{ status: 304 }` would likely move pass rate from 2/3 to 3/3.

4. **furiosa's speed is a false positive.** 10 min completion with a FAIL is worse than 21 min with a PASS. Consider whether the `gt done` instruction should emphasize verifying ALL criteria before submitting, not just "when implementation is complete."

5. **Consider a Tier 5.1 re-run** with a single hint: "Use `this.getContext()` to access HTTP request headers in your Resource class." This would test whether the failure is doc-discoverability or deeper comprehension.

6. **No test scripts is a regression.** Tier 4 had 3/3 test scripts; Tier 5 had 0/3. The assignment asks agents to "demonstrate" caching but doesn't trigger test-writing. Consider adding "Write a test script that demonstrates the caching behavior" to the assignment's deliverables.

## Artifacts

- Convoy: hq-cv-fegte
- Beads: dl-3lp9 (W1, FAIL), dl-m3y8 (W2, PASS), dl-8hg4 (W3, PASS)
- Component dirs: `.workers/worker-{1,2,3}/components/product-catalog/`
