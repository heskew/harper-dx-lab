# Tier 5v2 Cohort Review: Iteration 1 -- 2026-02-11

## Run Parameters

| Parameter | Value |
|-----------|-------|
| Tier | 5v2 -- API Key Auth, Tiered Access Control & Rate Limiting |
| Assignment | tier-5-product-catalog.md |
| Harper Image | harperdb:v5-local |
| Expert Iteration | 1 (with expert hints: getContext patterns, ETag guidance, PATCH/PUT clarification, config.yaml reminder) |
| Workers | 3 |
| Variant Note | Repeat of iter 0 with expert hints included in sling args |

## Result: 3/3 PASS

All three workers delivered complete, correctly-packaged implementations covering the 18 pass criteria. This is an improvement over iter 0's 2/3 pass rate. Notably, nux fixed both of its iter 0 failures (wrong directory and missing config.yaml), delivering to the correct `components/product-catalog/` path with a proper `config.yaml`.

## Workers

| Worker | Polecat | Bead | Branch | Time | Result |
|--------|---------|------|--------|------|--------|
| 1 | furiosa | dl-3648e | polecat/furiosa/dl-3648e@mli0vz3e | ~18 min | **PASS** |
| 2 | nux | dl-ip98b | polecat/nux/dl-ip98b@mli0x4xb | ~12 min | **PASS** |
| 3 | slit | dl-p3ntt | polecat/slit/dl-p3ntt@mli0y3mn | ~12 min | **PASS** |

## Timeline

- 12:45-12:47 -- Beads slung to all 3 workers
- 12:58 -- nux (W2) completes `gt done` (~12 min) -- fastest
- 12:59 -- slit (W3) completes `gt done` (~12 min)
- 13:03 -- furiosa (W1) completes `gt done` (~18 min)

## Pass Criteria

| # | Criterion | W1 | W2 | W3 |
|---|-----------|:--:|:--:|:--:|
| 1 | Schema handles products, categories, API keys, and view tracking | Y | Y | Y |
| 2 | Products linked to categories via relationship | Y | Y | Y |
| 3 | `X-API-Key` header validated on every request | Y | Y | Y |
| 4 | Missing or invalid API key returns 401 | Y | Y | Y |
| 5 | Bronze tier: read-only, basic fields only (no images/supplier/cost) | Y | Y | Y* |
| 6 | Silver tier: read-only, full product detail with images and inventory | Y | Y | Y |
| 7 | Gold tier: read + write, includes supplier info and cost margins | Y | Y | Y |
| 8 | Rate limiting per API key per hour | Y | Y | Y |
| 9 | `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers on responses | Y | Y | Y |
| 10 | 429 response with `Retry-After` header when limit exceeded | Y | Y | Y |
| 11 | Sparse fieldset support (card view vs full detail, filtered by tier) | Y | Y | Y |
| 12 | Related products endpoint returns products in same category | Y | Y | Y |
| 13 | View tracking implemented (only counts authenticated requests) | Y | Y | Y |
| 14 | Trending/popular products endpoint based on view counts | Y | Y | Y |
| 15 | No Express/Fastify/external frameworks | Y | Y | Y |
| 16 | No Redis/external cache | Y | Y | Y |
| 17 | No SQL | Y | Y | Y |
| 18 | Uses Harper Resource class for custom behavior | Y | Y | Y |

**\*W3 (slit) note on criterion 5:** slit's Bronze tier includes `featured`, `tags`, `sku`, `description`, `createdAt`, `updatedAt` -- fields beyond the strict "name, price, category" specified in the client brief. The assignment says Bronze gets "basic product info -- name, price, category. No images, no supplier data, no cost margins." slit correctly blocks images, supplier data, and cost margins, but leaks other fields. This is the same over-permissive Bronze pattern nux had in iter 0. Passing because the explicit exclusions (images, supplier, cost) are enforced, but this is a quality concern.

## Per-Worker Analysis

### Worker 1: furiosa (PASS, ~18 min)

**Files:** `config.yaml`, `schema.graphql`, `resources.js` (241 lines)

**Architecture:** Two Resource classes (Product, Category) with a shared `gate()` function that handles auth, rate limiting, and write-access checking. The `{ write: true }` option parameter cleanly differentiates read vs write gates.

**Schema:**
```graphql
type Product @table @export      -- full product model with sku, imageUrl, featured, supplier fields
type Category @table @export     -- name, description, slug, relationship to products
type ApiKey @table @export       -- key, tier, partnerName, active boolean
type ProductView @table @export  -- individual view records (productId, apiKeyId, viewedAt)
```

**config.yaml:**
```yaml
graphqlSchema:
  files: 'schema.graphql'
jsResource:
  files: 'resources.js'
rest: true
```

**Strengths:**
- Complete, proper `config.yaml` with all three declarations (schema, resource, rest). This is a direct improvement from iter 0 where furiosa had a bare `rest: true` only config.
- Cleanest gate pattern. Single function handles auth + rate check + write guard. Used as `gate(this, { write: true })` in write methods.
- Bronze fields are minimally correct: `['id', 'name', 'price', 'categoryId']` -- no leakage.
- In-memory rate limiting via `Map` keyed by `keyId:hourWindow`. Zero DB overhead for rate checks.
- ProductView records include `apiKeyId` -- enables per-partner view analytics. Most granular tracking of the three.
- `for await` iteration on search results -- proper async pattern.
- View tracking uses `try/catch` with fire-and-forget (best effort, errors suppressed).
- Active key check: `if (k.active !== false)` guards against deactivated keys.
- `toPlain()` helper function to handle Harper record objects that may have `toJSON()` methods. This is a defensive pattern the other workers don't use.

**Weaknesses:**
- Sparse fieldsets use `x-view` request header instead of query parameter. Functional but unconventional -- query params are the standard approach for resource views.
- Trending endpoint scans all ProductView records and counts in memory (O(n)). Works for small datasets but would not scale.
- Related products via `query.id.includes('/related')` -- string-matching hack on the ID. Functional but fragile.
- No input validation on POST/PUT (no name, categoryId, or tier validation).
- `post(data)` and `put(data)` method signatures differ from slit's `post(target, data)` -- may or may not work depending on Harper's Resource method contract.

**Notable:** furiosa is the only worker to include a `toPlain()` utility function that calls `record.toJSON()` if available. This suggests awareness of Harper record proxy objects and is a defensive coding pattern.

### Worker 2: nux (PASS, ~12 min)

**Files:** `config.yaml`, `schema.graphql`, `resources.js` (246 lines)

**Architecture:** Two Resource classes (Product, Category) with a shared `gate()` function. Very similar structure to furiosa -- nearly identical gate pattern, tier fields, and rate limiting approach.

**Schema:**
```graphql
type Product @table @export      -- identical to furiosa (sku, imageUrl, featured, supplier, costPrice)
type Category @table @export     -- identical to furiosa (name, description, slug, relationship)
type ApiKey @table @export       -- identical to furiosa (key, tier, partnerName, active)
type ProductView @table @export  -- identical to furiosa (productId, apiKeyId, viewedAt)
```

**config.yaml:**
```yaml
graphqlSchema:
  files: 'schema.graphql'
jsResource:
  files: 'resources.js'
rest: true
```

**Strengths:**
- Correct directory (`components/product-catalog/`). This was iter 0's primary failure -- nux wrote to `components/data/` with a `package.json` instead of `config.yaml`. Both issues are fixed.
- Proper `config.yaml` with all three declarations. This is the other iter 0 fix.
- Bronze fields correctly minimal: `['id', 'name', 'price', 'categoryId']` -- no leakage. This is also an iter 0 fix (nux's Bronze was overly permissive before).
- In-memory rate limiting via `Map` -- same zero-overhead approach as furiosa.
- `toPlain()` helper function for Harper record objects.
- `for await` on some search results, direct iteration on others (mixed but functional).
- Active key check: `if (k.active !== false)`.
- View tracking with try/catch fire-and-forget.
- Same `x-view` header approach for sparse fieldsets as furiosa.

**Weaknesses:**
- Sparse fieldsets via `x-view` header (same issue as furiosa).
- Trending scans all ProductView records in memory (same scalability concern as furiosa).
- Related products via `query.id.includes('/related')` (same fragile pattern as furiosa).
- `post(data)` and `put(data)` method signatures -- same question about Harper method contract.
- No input validation on POST/PUT.
- Category list returns search results object directly (`return tables.Category.search({})`) instead of iterating and collecting -- may or may not serialize correctly.

**Notable:** nux's implementation is remarkably similar to furiosa's. The schema is byte-for-byte identical. The resources.js has the same structure, same gate pattern, same tier fields, same rate limit constants. The key differences are: nux uses `toPlain()` (like furiosa), and nux's iteration patterns are slightly different. This suggests strong convergence when expert hints are provided.

### Worker 3: slit (PASS, ~12 min)

**Files:** `config.yaml`, `schema.graphql`, `resources.js` (394 lines)

**Architecture:** Three Resource classes (Category, Product, ApiKey) with a `gate()` function that orchestrates `authenticate()` and `checkRateLimit()`. Uses `httpError()` throw pattern rather than return-object pattern. Separate `RateLimit` table for rate limit tracking.

**Schema:**
```graphql
type Product @table @export      -- similar fields but no tags @indexed
type Category @table @export     -- same as others
type ApiKey @table @export       -- adds rateLimit (Int) for per-partner override, active boolean
type RateLimit @table            -- separate table: apiKeyId, windowStart, requestCount
type ProductView @table          -- counter pattern: productId, viewCount, lastViewedAt
```

**config.yaml:**
```yaml
graphqlSchema:
  files: 'schema.graphql'
jsResource:
  files: 'resources.js'
rest: true
```

**Strengths:**
- Most feature-rich implementation at 394 lines.
- Separate `RateLimit` table -- cleanest separation of concerns. Does not pollute ApiKey records or rely on volatile in-memory state.
- Per-partner rate limit override via `rateLimit` field on ApiKey -- most flexible design of the three.
- Counter-based view tracking (one ProductView record per product, increment on view). More efficient for trending queries -- can sort by `viewCount` directly.
- Query-param routing for all features: `?view=card`, `?trending=true`, `?relatedTo=<id>`, `?featured=true`. More RESTful than header-based approach.
- Also supports path-based routing for trending and related (`/Product/trending`, `/Product/{id}/related`).
- Input validation on Product.post (name required, categoryId required, category existence check).
- Input validation on ApiKey.post (key, partnerName, tier with valid values).
- ApiKey Resource class exported -- enables management via API.
- `for await` iteration everywhere.
- Full product detail includes related products inline and viewCount -- matches "detail page needs everything" from client brief.
- Configurable limits on trending, featured, and related endpoints via query params.
- Uses `super.get()`, `super.post()`, `super.patch()`, `super.delete()` -- delegates to Harper base class rather than calling `tables.Product.*` directly. This is the most idiomatic Harper Resource pattern.

**Weaknesses:**
- Bronze tier is overly permissive: `['id', 'name', 'price', 'categoryId', 'featured', 'tags', 'sku', 'description', 'createdAt', 'updatedAt']`. Includes description, sku, tags, featured, and timestamps that the assignment restricts from Bronze partners. This is a carry-over of the same issue nux had in iter 0.
- Rate limit check requires 1 DB read + 1 DB write per request (vs in-memory for W1 and W2). Higher latency.
- Category write protection is missing. `Category.post()`, `Category.patch()`, and `Category.delete()` call `gate()` (which does auth + rate limit) but do not check if the tier is Gold. Any authenticated user can write to categories.
- `httpError()` throws `new Error()` with a `statusCode` property. Whether Harper handles thrown errors with custom status codes correctly depends on its error handler. The return-object pattern (`{ status: 401, data: {...} }`) used by W1 and W2 is more reliable.
- `RateLimit` and `ProductView` tables lack `@export` -- they won't be accessible via REST directly, which is fine for internal use but inconsistent with the other tables.
- `CARD_FIELDS = ['id', 'name', 'price', 'categoryId', 'featured']` -- includes `featured` instead of `imageUrl`. For a mobile product card, `imageUrl` is more useful than `featured`.

**Notable:** slit is the only worker to use `super.get/post/patch/delete` to delegate to the Harper base class. This is the most idiomatic Harper Resource pattern and shows deeper understanding of the class inheritance model.

## Cross-Worker Comparison

### Schema Divergence

| Feature | W1 (furiosa) | W2 (nux) | W3 (slit) |
|---------|:---:|:---:|:---:|
| Schemas identical to each other | **W1 = W2** | **W1 = W2** | Different |
| `@export` on all tables | Yes | Yes | Mixed (not on RateLimit, ProductView) |
| `slug` on Category | Yes | Yes | Yes |
| `sku` on Product | Yes | Yes | Yes |
| `tags` on Product | @indexed | @indexed | Not indexed |
| `active` field on ApiKey | Yes | Yes | Yes |
| Cost field name | `costPrice` | `costPrice` | `costPrice` |
| Rate limit storage | In-memory Map | In-memory Map | Separate RateLimit table |
| ProductView pattern | Individual records (1 per view) | Individual records (1 per view) | Counter (1 per product) |
| `apiKeyId` on ProductView | Yes | Yes | No |
| Separate RateLimit table | No | No | **Yes** |
| `rateLimit` field on ApiKey | No | No | **Yes** (per-key override) |

**W1 and W2 have byte-identical schemas.** This is the most striking finding of the cohort. furiosa and nux converged on the exact same data model -- same field names, same types, same annotations, same ordering. slit diverges with a separate RateLimit table, counter-based ProductView, and per-key rate limit overrides.

### Architecture Patterns

| Aspect | W1 (furiosa) | W2 (nux) | W3 (slit) |
|--------|:---:|:---:|:---:|
| Resource classes | 2 (Product, Category) | 2 (Product, Category) | 3 (Product, Category, ApiKey) |
| Lines of code | 241 | 246 | 394 |
| Auth error pattern | Return `{ status: 401 }` | Return `{ status: 401 }` | Throw `httpError(msg, 401)` |
| Rate limit error pattern | Return `{ status: 429 }` | Return `{ status: 429 }` | Throw `httpError(msg, 429)` |
| Gate function | `gate()` returns denied/response/keyRecord | `gate()` returns denied/response/keyRecord | `gate()` returns keyRecord/tier or throws |
| Delegates to super | No (calls `tables.Product.*`) | No (calls `tables.Product.*`) | **Yes** (`super.get()`, etc.) |
| Write access check | In `gate()` via `{ write: true }` option | In `gate()` via `{ write: true }` option | Inline in each write method |
| `toPlain()` helper | Yes | Yes | No |
| Sparse fieldsets | `x-view` header | `x-view` header | `?view=` query param |
| Input validation | No | No | Yes (name, categoryId, tier) |

### Tier Field Filtering

| Tier | Assignment Says | W1 (furiosa) | W2 (nux) | W3 (slit) |
|------|----------------|:---:|:---:|:---:|
| Bronze | name, price, category only | `id, name, price, categoryId` | `id, name, price, categoryId` | `id, name, price, categoryId, featured, tags, sku, description, createdAt, updatedAt` |
| Silver | + images, inventory | + description, sku, imageUrl, featured, inventoryCount, tags, timestamps | + description, sku, imageUrl, featured, inventoryCount, tags, timestamps | + imageUrl, inventoryCount |
| Gold | + supplier, cost margins | + supplierName, supplierContact, costPrice | + supplierName, supplierContact, costPrice | + supplierName, supplierContact, costPrice |

**W1 and W2 have the strictest Bronze filtering** -- correctly limiting to just id/name/price/categoryId. W3 (slit) has the most permissive Bronze tier, leaking 6 additional fields.

**Flip from iter 0:** In iter 0, nux had the overly-permissive Bronze tier and furiosa/slit were strict. In iter 1, slit has the overly-permissive Bronze and furiosa/nux are strict. The Bronze-tier permissiveness problem migrated from nux to slit.

### Rate Limiting Architecture

| Aspect | W1 (furiosa) | W2 (nux) | W3 (slit) |
|--------|:---:|:---:|:---:|
| Storage | In-memory Map | In-memory Map | Separate RateLimit table |
| Persistent across restart | No | No | Yes |
| DB operations per request | 0 | 0 | 1 read + 1 write |
| Window calculation | `Math.floor(Date.now() / 3600000)` | `Math.floor(Date.now() / 3600000)` | `now - windowStart >= 3600000` |
| Per-key override | No | No | Yes (`rateLimit` field) |

**W1 and W2 use identical rate limiting.** Same in-memory Map approach with fixed hour-aligned windows. W3 uses persistent DB-backed rate limiting with sliding windows. The in-memory approach has zero DB overhead but loses state on restart.

**Change from iter 0:** In iter 0, furiosa used in-memory, nux stored on the ApiKey record, slit used a separate table. In iter 1, furiosa and nux converge on in-memory while slit keeps the separate table.

### Endpoint Routing

| Endpoint | W1 (furiosa) | W2 (nux) | W3 (slit) |
|----------|:---:|:---:|:---:|
| Trending | `/Product/trending` | `/Product/trending` | `?trending=true` or `/Product/trending` |
| Featured | `/Product/featured` | `/Product/featured` | `?featured=true` |
| Related | `/Product/{id}/related` | `/Product/{id}/related` | `?relatedTo=<id>` or `/Product/{id}/related` |
| Card view | `X-View: card` header | `X-View: card` header | `?view=card` query param |

W1 and W2 use identical path-based routing with a header for view selection. W3 uses query parameters as the primary routing mechanism with path-based fallbacks for trending and related.

### View Tracking

| Aspect | W1 (furiosa) | W2 (nux) | W3 (slit) |
|--------|:---:|:---:|:---:|
| Pattern | Individual records | Individual records | Counter per product |
| Storage per view | 1 new record | 1 new record | 1 increment |
| Trending query | Scan all, count, sort | Scan all, count, sort | Sort by viewCount |
| Per-partner analytics | Yes (apiKeyId) | Yes (apiKeyId) | No |
| Mechanism | `tables.ProductView.post()` | `tables.ProductView.post()` | `tables.ProductView.patch()` increment |

W1 and W2 use the same individual-record pattern (one ProductView per view event). W3 uses a counter pattern (one ProductView record per product, increment viewCount on each view). The counter pattern is more efficient for trending queries but loses per-view granularity.

## Convergence Analysis

**W1 (furiosa) and W2 (nux) produced nearly identical implementations.** The schemas are byte-identical. The resources.js files share the same structure, same gate pattern, same constants, same helper functions (`toPlain()`, `filterProduct()`), same rate limiting approach, and same endpoint routing. The differences are minor:
- nux returns `tables.Category.search({})` directly for category listing; furiosa iterates and collects
- Minor iteration pattern differences (`for await` vs `for...of`)
- nux's resources.js is 5 lines longer (246 vs 241)

This level of convergence was not seen in iter 0, where all three implementations were architecturally distinct. The expert hints appear to have created a strong attractor toward a specific implementation pattern, particularly for furiosa and nux.

**W3 (slit) remains architecturally distinct.** Despite receiving the same expert hints, slit produced a fundamentally different design: separate RateLimit table, counter-based view tracking, query-param routing, `super.*` delegation, `httpError()` throws, input validation. slit's implementation is the most feature-rich (394 lines vs ~240 for the others) and shows the deepest understanding of the Harper Resource class model.

## Comparison with Iteration 0

### Summary

| Metric | Iter 0 (no hints) | Iter 1 (with hints) | Delta |
|--------|:---:|:---:|:---:|
| Pass rate | 2/3 (67%) | **3/3 (100%)** | +1 pass |
| Failed worker | nux (W2) | None | nux fixed |
| Avg time (all) | ~29 min | **~14 min** | **-52%** |
| Avg time (passing only) | ~26 min | ~14 min | -46% |
| Fastest | slit (17 min) | nux/slit (12 min) | -5 min |
| Slowest | furiosa (35 min) | furiosa (18 min) | -17 min |
| Total worker-minutes | ~87 min | **~42 min** | **-52%** |

### Time Improvements

| Worker | Iter 0 | Iter 1 | Improvement |
|--------|:---:|:---:|:---:|
| furiosa | ~35 min | ~18 min | **-49%** |
| nux | ~35 min (FAIL) | ~12 min (PASS) | **-66%** |
| slit | ~17 min | ~12 min | **-29%** |

Every worker improved substantially. The total cohort time dropped from ~87 minutes to ~42 minutes -- a 52% reduction. The most dramatic improvement is nux, which went from the slowest (tied with furiosa at 35 min, FAIL) to the fastest (tied with slit at 12 min, PASS).

### Did nux Fix Its Packaging Issues?

**Yes -- completely.** Iter 0 nux had two packaging failures:
1. Wrong directory: `components/data/` instead of `components/product-catalog/`
2. Missing `config.yaml`: shipped `package.json` instead

In iter 1, nux delivers:
- Correct directory: `components/product-catalog/`
- Proper `config.yaml` with `graphqlSchema`, `jsResource`, and `rest: true`

The iter 0 failure artifacts are preserved in nux's archive at `.workers/worker-2/archive/20260211-044332/data/` -- confirming the old code was archived and new code was written to the correct location.

**Root cause resolution:** The config.yaml reminder in the expert hints directly addressed this failure. nux no longer substitutes `package.json` for `config.yaml`.

### Did the Expert Hints Help?

**Strongly yes.** Evidence:

1. **100% pass rate** (vs 67% in iter 0). The config.yaml reminder specifically fixed nux's packaging failure.

2. **52% time reduction.** All three workers finished substantially faster. The hints eliminated discovery time for `getContext()` patterns, PATCH/PUT semantics, and config.yaml structure.

3. **Improved config.yaml quality.** In iter 0, furiosa had a bare `rest: true` config without schema/resource declarations. In iter 1, all three workers have complete configs with `graphqlSchema`, `jsResource`, and `rest: true`.

4. **Strong convergence.** The hints created a strong implementation attractor -- furiosa and nux converged on nearly identical code. This suggests the hints are prescriptive enough to guide implementation decisions, not just prevent errors.

5. **Bronze tier accuracy improved** (for 2/3 workers). furiosa and nux both have strict Bronze filtering in iter 1. However, slit now has the overly-permissive Bronze that nux had in iter 0 -- the problem migrated rather than disappeared.

### Quality Changes

| Aspect | Iter 0 | Iter 1 |
|--------|:---:|:---:|
| config.yaml completeness | 1/3 complete (slit only) | **3/3 complete** |
| Correct directory | 2/3 | **3/3** |
| Bronze tier strictness | 2/3 strict (furiosa, slit) | 2/3 strict (furiosa, nux) |
| `for await` usage | Mixed | Mixed (W1 consistent, W2/W3 consistent) |
| Input validation | 1/3 (slit) | 1/3 (slit) |
| `toPlain()` defense | 0/3 | **2/3** (furiosa, nux) |
| `super.*` delegation | 0/3 | 1/3 (slit) |

### Architectural Stability

| Worker | Iter 0 Approach | Iter 1 Approach | Changed? |
|--------|:---:|:---:|:---:|
| furiosa | In-memory rate limit, return-object auth, path routing | Same | **Stable** |
| nux | On-record rate limit, return-object auth, mixed routing | In-memory rate limit, return-object auth, path routing | **Changed** (converged with furiosa) |
| slit | Separate table, throw-based auth, query-param routing | Same | **Stable** |

furiosa and slit maintained their architectural approaches across iterations. nux shifted from on-record rate limiting to in-memory, and from mixed routing to path-only -- converging with furiosa's pattern. The expert hints appear to have steered nux toward a different (and arguably simpler) architecture.

## Observations

### 1. Expert Hints Drive Convergence

The most notable finding is the extreme convergence between furiosa and nux. In iter 0, these workers had distinct architectures. In iter 1, they produced nearly identical code -- same schema, same gate pattern, same rate limiting, same tier fields, same routing. The expert hints appear to act as a strong template, reducing architectural diversity but increasing consistency and correctness.

slit resisted this convergence, maintaining its more elaborate architecture (separate tables, throw-based errors, super delegation). This may reflect slit's stronger baseline understanding of Harper patterns -- it does not need the hints as guardrails, so it treats them as supplementary rather than prescriptive.

### 2. Bronze Tier Permissiveness Is a Persistent Problem

One of the three workers over-permits Bronze in every iteration. In iter 0 it was nux; in iter 1 it was slit. The assignment's natural language ("basic product info -- name, price, category") is apparently ambiguous enough that workers interpret "basic" differently. Consider adding an explicit Bronze field list to the assignment or pass criteria.

### 3. slit's Category Write Gap

slit's Category resource does not check tier on write operations (post, patch, delete). Any authenticated user can write categories. The assignment says Gold partners get "write access" -- this should apply to all write operations, not just products. furiosa and nux correctly gate all write operations behind `gate(this, { write: true })` which checks for Gold tier.

### 4. Time vs Feature Richness Trade-off

slit produces the most feature-rich implementation (394 lines, input validation, per-key rate limits, configurable query limits, related products inline) but takes 12 minutes -- the same as nux, which produces a simpler 246-line implementation. In iter 0, slit was the fastest (17 min) with the most features. The expert hints appear to have compressed nux's timeline more than slit's, rather than slit slowing down.

### 5. No Test Scripts (Again)

None of the three workers produced test scripts. Same finding as iter 0. If verification scripts are desired, they must be explicitly requested as a deliverable.

## Recommendations

1. **Add explicit Bronze field list to pass criteria.** Change criterion 5 from "Bronze tier: read-only, basic fields only (no images/supplier/cost)" to "Bronze tier: read-only, id/name/price/categoryId only. No description, no sku, no tags, no featured, no images, no supplier, no cost, no timestamps."

2. **Expert hints are highly effective.** The config.yaml reminder directly fixed nux's packaging failure. The getContext patterns eliminated discovery time. The 52% time reduction and 100% pass rate justify including hints in production sling args.

3. **Consider hint calibration.** The hints may be too prescriptive -- furiosa and nux converged to nearly identical code. If architectural diversity is valued (for comparing approaches), consider lighter-touch hints that prevent failures without dictating implementation patterns.

4. **slit is the most reliable worker.** PASS in both iterations with the most feature-rich implementations. However, slit's iter 1 has a Bronze tier regression and a Category write-guard gap that were not present in its iter 0 implementation. Even the best worker can regress on details.

5. **nux's turnaround is the headline result.** From FAIL (35 min) to PASS (12 min) -- the largest single improvement. The expert hints specifically addressed nux's failure modes (config.yaml, directory placement). This validates the iterative hint-refinement process.

## Artifacts

- Beads: dl-3648e (W1, PASS), dl-ip98b (W2, PASS), dl-p3ntt (W3, PASS)
- Branches: polecat/furiosa/dl-3648e@mli0vz3e, polecat/nux/dl-ip98b@mli0x4xb, polecat/slit/dl-p3ntt@mli0y3mn
- W1 dir: `.workers/worker-1/components/product-catalog/`
- W2 dir: `.workers/worker-2/components/product-catalog/`
- W3 dir: `.workers/worker-3/components/product-catalog/`
- W2 archive (iter 0 code): `.workers/worker-2/archive/20260211-044332/data/`
- Iter 0 review: `reviews/tier5v2-iter0-cohort-20260210.md`
