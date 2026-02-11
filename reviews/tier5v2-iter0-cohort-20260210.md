# Tier 5v2 Cohort Review: 2026-02-10

## Run Parameters

| Parameter | Value |
|-----------|-------|
| Tier | 5v2 -- API Key Auth, Tiered Access Control & Rate Limiting |
| Assignment | tier-5-product-catalog.md |
| Harper Image | harperdb:v5-local |
| Expert Iteration | 0 (no expert hints) |
| Workers | 3 |
| Variant Note | NEW v2 assignment. Replaces caching/ETags with auth, tiered access, rate limiting. |

## Result: 2/3 PASS, 1/3 PARTIAL FAIL

Workers 1 (furiosa) and 3 (slit) delivered complete implementations covering all 18 pass criteria. Worker 2 (nux) implemented the v2 requirements (auth, tiers, rate limiting) but wrote files to the wrong directory (`components/data/` instead of `components/product-catalog/`) and shipped without a `config.yaml`, which would prevent Harper from loading the component. Nux also has a residual archive from the previous v1 assignment (ETags/caching) that does not apply here.

## Workers

| Worker | Polecat | Bead | Branch | Time | Result |
|--------|---------|------|--------|------|--------|
| 1 | furiosa | dl-jqp0m | polecat/furiosa/dl-jqp0m@mlhhb6dg | ~35 min | PASS |
| 2 | nux | dl-798ej | polecat/nux/dl-798ej@mlhhc3ux | ~35 min | **FAIL** |
| 3 | slit | dl-s7v6c | polecat/slit/dl-s7v6c@mlhhd1j7 | ~17 min | PASS |

**Notable:** slit finished in half the time of the other two workers and produced the most complete implementation. furiosa took twice as long but also delivered a passing result. nux took the same time as furiosa but shipped to the wrong directory with a missing config, despite the bead instructions explicitly stating the target path.

## Timeline

- 19:36-19:39 -- Beads slung, molecules attached to all 3 workers
- 19:54 -- slit (W3) completes `gt done` (~17 min) -- fastest, all 18 criteria met
- 20:12 -- furiosa (W1) and nux (W2) complete `gt done` (~35 min each)

## Pass Criteria

| # | Criterion | W1 | W2 | W3 |
|---|-----------|:--:|:--:|:--:|
| 1 | Schema handles products, categories, API keys, and view tracking | Y | Y | Y |
| 2 | Products linked to categories via relationship | Y | Y | Y |
| 3 | `X-API-Key` header validated on every request | Y | Y | Y |
| 4 | Missing or invalid API key returns 401 | Y | Y | Y |
| 5 | Bronze tier: read-only, basic fields only (no images/supplier/cost) | Y | Y | Y |
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

**All three workers met all 18 functional criteria in their code.** However, Worker 2 has a deployment-level failure: wrong directory and missing config.yaml. The code is correct; the packaging is not.

### Worker 2 Failure Analysis

nux's functional code is sound -- it implements all 18 criteria correctly. The failure is operational:

1. **Wrong directory.** The bead instructions said: *"Write all files to .workers/worker-2/components/product-catalog/"*. nux wrote to `.workers/worker-2/components/data/` instead. Harper components are identified by directory name; this means the component would not be found at the expected path.

2. **Missing config.yaml.** nux shipped a `package.json` (with `"name": "product-catalog"` and `"type": "module"`) but no `config.yaml`. Without the config declaring `graphqlSchema`, `jsResource`, and `rest: true`, Harper cannot load the schema or resource files. The archive directory contains a proper config.yaml from the previous v1 run, suggesting nux may have confused the two implementations.

3. **Residual archive.** The archive at `.workers/worker-2/archive/20260210-193609/product-catalog/` contains a complete v1 implementation (ETags, caching, no auth) -- this is from the previous Tier 5 assignment variant. The active `components/data/` directory has the v2 code. nux appears to have been re-dispatched from a v1 run and correctly rebuilt the implementation for v2, but fumbled the directory placement.

**Root cause hypothesis:** nux may have used a generic component name (`data`) either from a template or habit, and substituted `package.json` for `config.yaml` based on Node.js conventions rather than Harper conventions.

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
  supplierName: String
  supplierContact: String
  costPrice: Float
  inventoryCount: Int
  createdAt: Float @createdTime
  updatedAt: Float @updatedTime
}

type ApiKey @table @export {
  id: ID @primaryKey
  key: String @indexed
  tier: String @indexed
  partnerName: String
  active: Boolean @indexed
  createdAt: Float @createdTime
  updatedAt: Float @updatedTime
}

type ProductView @table @export {
  id: ID @primaryKey
  productId: ID @indexed
  apiKeyId: ID @indexed
  viewedAt: Float @createdTime
}
```

### Worker 2 (nux)
```graphql
type Product @table @export {
  id: ID @primaryKey
  name: String @indexed
  description: String
  price: Float
  categoryId: ID @indexed
  category: Category @relationship(from: categoryId)
  imageUrl: String
  inventoryCount: Int
  supplierName: String
  supplierContact: String
  costMargin: Float
  featured: Boolean @indexed
  tags: [String] @indexed
  createdAt: Float @createdTime
  updatedAt: Float @updatedTime
}

type Category @table @export {
  id: ID @primaryKey
  name: String @indexed
  slug: String @indexed
  description: String
  products: [Product] @relationship(to: categoryId)
  createdAt: Float @createdTime
  updatedAt: Float @updatedTime
}

type ApiKey @table @export {
  id: ID @primaryKey
  key: String @indexed
  partnerName: String
  tier: String @indexed
  requestCount: Int
  windowStart: Float
  createdAt: Float @createdTime
}

type ProductView @table @export {
  id: ID @primaryKey
  productId: ID @indexed
  viewCount: Int @indexed
  lastViewedAt: Float
}
```

### Worker 3 (slit)
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
  sku: String @indexed
  imageUrl: String
  featured: Boolean @indexed
  categoryId: ID @indexed
  category: Category @relationship(from: categoryId)
  supplierName: String
  supplierContact: String
  costPrice: Float
  inventoryCount: Int
  tags: [String]
  createdAt: Float @createdTime
  updatedAt: Float @updatedTime
}

type ApiKey @table @export {
  id: ID @primaryKey
  key: String @indexed
  partnerName: String
  tier: String @indexed
  rateLimit: Int
  active: Boolean @indexed
  createdAt: Float @createdTime
  updatedAt: Float @updatedTime
}

type RateLimit @table {
  id: ID @primaryKey
  apiKeyId: ID @indexed
  windowStart: Float
  requestCount: Int
}

type ProductView @table {
  id: ID @primaryKey
  productId: ID @indexed
  viewCount: Int @indexed
  lastViewedAt: Float
}
```

### Schema Divergence

| Feature | W1 (furiosa) | W2 (nux) | W3 (slit) |
|---------|:---:|:---:|:---:|
| `@export` on all tables | Yes | Yes | Mixed (not on RateLimit, ProductView) |
| `slug` on Category | Yes | Yes | Yes |
| `sku` on Product | Yes | No | Yes |
| `tags` on Product | Yes (@indexed) | Yes (@indexed) | Yes (not indexed) |
| `active` field on ApiKey | Yes | No | Yes |
| Cost field name | `costPrice` | `costMargin` | `costPrice` |
| Rate limit storage | In-memory Map | On ApiKey record | Separate RateLimit table |
| ProductView pattern | Individual records (1 per view) | Counter (1 per product) | Counter (1 per product) |
| `apiKeyId` on ProductView | Yes | No | No |
| Separate RateLimit table | No | No | **Yes** |
| `rateLimit` field on ApiKey | No | No | **Yes** (per-key override) |

### Key Design Decisions

**Rate limit storage -- three different approaches:**

- **W1 (furiosa):** In-memory `Map` keyed by `apiKeyId:hourWindow`. Simplest and fastest. Zero DB overhead for rate checks. Downside: resets on process restart, not shared across instances.
- **W2 (nux):** Stores `requestCount` and `windowStart` directly on the `ApiKey` record. Persistent across restarts. Downside: mutates the API key record on every request, which is semantically impure.
- **W3 (slit):** Separate `RateLimit` table with one record per API key. Clean separation of concerns. Persistent. Also includes a `rateLimit` field on ApiKey for per-partner rate limit overrides -- the most flexible design.

**View tracking -- two approaches:**

- **W1 (furiosa):** Creates one ProductView record per view event, with `apiKeyId` tracking who viewed. Most granular -- can analyze viewing patterns per partner. But trending requires scanning all records and counting (O(n)).
- **W2 (nux) and W3 (slit):** Counter pattern -- one ProductView record per product with a `viewCount` integer. Increment on each view. Trending is a sorted query on viewCount. More efficient for trending but loses per-view granularity.

**ApiKey `active` field:**

- W1 and W3 include an `active` boolean for key deactivation without deletion. W1's auth code explicitly checks `if (k.active !== false)`. W3's schema has it but the auth code doesn't check it (relies on existence only).
- W2 omits the field entirely -- keys can only be removed, not deactivated.

## Resources.js Analysis

### Architecture Comparison

| Aspect | W1 (furiosa) | W2 (nux) | W3 (slit) |
|--------|:---:|:---:|:---:|
| Resource classes exported | 2 (Product, Category) | 3 (Product, Category, ApiKey) | 2 (Product, Category) |
| Lines of code | 237 | 337 | 394 |
| Auth pattern | Return `{ status: 401 }` | Return `{ status: 401 }` | Throw `httpError()` / return object |
| Rate limit pattern | Return `{ status: 429 }` | Return `{ status: 429 }` | Throw `httpError()` |
| Gate function | `gate()` returns `{ denied, response, keyRecord }` | `authenticate()` returns `{ error }` or `{ keyRecord }` | `gate()` throws on failure |
| Write access check | In `gate()` via `{ write: true }` option | Inline in each write method | Inline in each write method |
| `this.getContext()` used | Yes | Yes | Yes |
| `context.headers` read | Yes | Yes | Yes |
| `context.responseHeaders.set()` | Yes | Yes (via `setRateLimitHeaders`) | Yes |
| Sparse fieldsets mechanism | `x-view` request header | `view` query param | `view` query param |
| Featured products | Via `id === 'featured'` path | Via `id === 'featured'` path | Via `?featured=true` query param |
| Trending | Via `id === 'trending'` path | Via `id === 'trending'` path | Via `?trending=true` query param |
| Related products | Via `id.includes('/related')` | Via `id.includes('/')` | Via `?relatedTo=<id>` query param |
| Category write protection | Yes (Gold only) | Yes (Gold only) | Yes (Gold only) |
| Input validation on POST | No | No | Yes (name, categoryId, tier) |
| ApiKey management resource | No | No | Yes (with validation) |

### Worker 1 (furiosa) -- Compact Gate Pattern (PASS)

**Pattern:** Two Resource classes with a shared `gate()` function that handles auth, rate limiting, and write-access checking in one call.

```js
async function gate(resourceInstance, { write = false } = {}) {
  // 1. Authenticate via X-API-Key
  // 2. Check rate limit, set headers
  // 3. If write=true and not Gold, return 403
  return { denied: false, keyRecord, context };
}
```

**Strengths:**
- Cleanest gate pattern. The `{ write: true }` option elegantly handles both read and write auth in a single function.
- Rate limiting via in-memory Map is zero-overhead on the DB.
- View tracking uses `tables.ProductView.post()` inside a try/catch -- fire-and-forget with error suppression.
- Field filtering properly intersects tier permissions with card view: `if (view === 'card') allowed = allowed.filter(f => CARD_FIELDS.includes(f))`.
- Bronze fields are minimal and correct: `['id', 'name', 'price', 'categoryId']` -- no images, no supplier, no cost.

**Weaknesses:**
- Sparse fieldsets use the `x-view` request header rather than a query parameter. The assignment says "Provide a way for clients to request only the fields they need" -- a header works but query params are more conventional for field selection.
- No input validation on POST/PUT.
- Related products via `query.id.includes('/related')` is a string-matching hack on the ID parameter -- functional but fragile.
- The `config.yaml` is bare (`rest: true` only) -- no schema/resource file declarations. This may or may not work depending on Harper's auto-discovery conventions.

**Notable:** furiosa is the only worker to track `apiKeyId` on ProductView records, enabling per-partner view analytics. This goes beyond the brief but shows good data modeling instincts.

### Worker 2 (nux) -- Comprehensive But Mispackaged (FAIL)

**Pattern:** Three Resource classes. Product handles all custom routing. Category is auth-gated. ApiKey has creation validation.

**Auth approach:** Uses error-return pattern rather than throwing:
```js
async function authenticate(resourceInstance) {
  // Returns { error: { status: 401, ... } } on failure
  // Returns { keyRecord, context } on success
}
```

**Strengths:**
- Most comprehensive implementation. 337 lines covering every aspect.
- Rate limiting stored on the ApiKey record itself -- persistent across restarts. Uses `tables.ApiKey.patch()` to increment count.
- Both path-based (`/Product/trending`, `/Product/{id}/related`) and query-param routing (`?relatedTo=<id>`, `?trending=true`).
- ApiKey resource with creation validation (requires key, partnerName, valid tier).
- Featured products endpoint.
- View tracking with fire-and-forget (`this.trackView(...).catch(() => {})`).
- `for await` iteration on search results -- proper async iteration pattern.
- Also sets rate limit headers on 401 responses (edge case handling).

**Weaknesses:**
- **Wrong directory** (`components/data/` instead of `components/product-catalog/`).
- **Missing config.yaml** -- has `package.json` instead. Harper needs config.yaml to know about schema and resource files.
- Bronze fields include too many fields: `['id', 'name', 'price', 'categoryId', 'featured', 'tags', 'sku', 'description', 'createdAt', 'updatedAt']`. The assignment says Bronze gets "name, price, category" only -- no description, no sku, no tags, no featured, no timestamps. This is a tier-filtering accuracy issue.
- Rate limit state on ApiKey is semantically impure -- the API key record changes on every request.
- `httpError()` throws `new Error()` with a `statusCode` property. Whether Harper handles this correctly depends on its error handling -- returning a `{ status, data }` object (like W1 and the fallback in W2's `authenticate`) is more reliable.

### Worker 3 (slit) -- Most Feature-Rich (PASS)

**Pattern:** Two Resource classes with rich query-param routing and a separate RateLimit table.

**Auth approach:** Hybrid -- `authenticate()` throws on missing/invalid key, `checkRateLimit()` returns rate info, `gate()` orchestrates both:
```js
async function gate(resourceInstance) {
  const { keyRecord } = await authenticate(context);  // throws 401
  const rateInfo = await checkRateLimit(keyRecord, context);
  setRateLimitHeaders(context, rateInfo);
  if (rateInfo.exceeded) throw httpError('...', 429);
  return { keyRecord, tier: keyRecord.tier };
}
```

**Strengths:**
- Separate RateLimit table is the cleanest data model for rate limiting. Does not pollute ApiKey records.
- Per-partner rate limit override via `rateLimit` field on ApiKey -- can give a specific partner a custom limit beyond their tier default.
- `for await` iteration everywhere -- proper async patterns.
- Uses `tables.RateLimit.put()` for window reset and `tables.RateLimit.patch()` for increment -- correct upsert pattern.
- Full view on single product includes `relatedProducts` inline -- matches the client brief's "detail page needs everything."
- Most thorough input validation: name required, categoryId required, category existence check, tier validation on ApiKey creation.
- ApiKey resource class with creation validation (key, partnerName, tier must be bronze/silver/gold).
- Featured products with limit parameter.
- Trending with configurable limit.

**Weaknesses:**
- Rate limit check requires a DB read + DB write on every request (vs W1's in-memory approach). Adds latency.
- `checkRateLimit` uses `tables.RateLimit.get(keyRecord.id)` -- assumes the RateLimit record ID equals the API key ID. This works as designed (the `put()` sets `id: keyRecord.id`) but is an implicit convention.
- `httpError()` pattern -- throws `new Error()` with `statusCode`. Same concern as W2 about whether Harper handles this correctly in all cases.

**Notable:** slit finished in 17 minutes -- half the time of the other two -- and produced the most feature-rich implementation with the best data model. This is the inverse of the v1 run where furiosa was fastest but failed. Speed + completeness.

## Cross-Worker Comparison

### Authentication Flow

All three workers implement the same core flow:
1. Read `x-api-key` header from `this.getContext().headers`
2. Look up the key via `tables.ApiKey.search({ conditions: [{ attribute: 'key', value: apiKeyHeader }] })`
3. Return 401 if missing or not found
4. Check rate limit
5. Return 429 if exceeded
6. Set rate limit headers on response
7. Proceed with tier-filtered response

The implementations diverge in error handling style (return error object vs throw) and where the rate limit state lives.

### Tier Field Filtering

| Tier | Assignment Says | W1 (furiosa) | W2 (nux) | W3 (slit) |
|------|----------------|:---:|:---:|:---:|
| Bronze | name, price, category only | `id, name, price, categoryId` | `id, name, price, categoryId, featured, tags, sku, description, createdAt, updatedAt` | `id, name, price, categoryId` |
| Silver | + images, inventory | + description, sku, imageUrl, featured, inventoryCount, tags, timestamps | + imageUrl, inventoryCount | + description, imageUrl, inventoryCount, tags, featured |
| Gold | + supplier, cost margins | + supplierName, supplierContact, costPrice | + supplierName, supplierContact, costMargin | + supplierName, supplierContact, costPrice |

**Critical finding: nux's Bronze tier is too permissive.** It includes description, sku, tags, featured, and timestamps -- fields the assignment explicitly restricts from Bronze ("basic product info -- name, price, category. No images, no supplier data, no cost margins"). While nux blocks images and supplier data, it leaks far more fields than intended.

furiosa and slit have the strictest Bronze filtering, correctly limiting to id/name/price/categoryId only.

### Rate Limiting Architecture

| Aspect | W1 (furiosa) | W2 (nux) | W3 (slit) |
|--------|:---:|:---:|:---:|
| Storage | In-memory Map | ApiKey record fields | Separate RateLimit table |
| Persistent across restart | No | Yes | Yes |
| DB operations per request | 0 | 1 write (patch) | 1 read + 1 write |
| Window calculation | `Math.floor(Date.now() / 3600000)` | `now - windowStart >= 3600000` | `now - windowStart >= 3600000` |
| Per-key override | No | No | Yes (`rateLimit` field) |
| Semantic purity | High (separate concern) | Low (mutates key record) | High (separate table) |

W1 uses fixed hour windows (aligned to clock hours). W2 and W3 use sliding windows from first request. Both are valid interpretations of "per hour."

### Sparse Fieldsets

| Mechanism | W1 (furiosa) | W2 (nux) | W3 (slit) |
|-----------|:---:|:---:|:---:|
| Card view trigger | `X-View: card` header | `?view=card` query param | `?view=card` query param |
| Full view trigger | `X-View: full` header (default) | `?view=full` query param | `?view=full` query param |
| Card fields | `id, name, price, categoryId, imageUrl` | `id, name, price, categoryId, featured` | `id, name, price, categoryId, imageUrl` |
| Tier intersection on card | Yes | Yes (intersects with tier) | Yes (intersects with tier) |

W1 uses a request header for view selection -- unconventional but functional. W2 and W3 use query parameters. All three properly intersect card fields with tier permissions (a Bronze card won't include imageUrl even if it's in CARD_FIELDS).

**Card field disagreement:** W1 and W3 include `imageUrl` in card fields (matches "product card" use case for mobile). W2 includes `featured` instead of `imageUrl`. For a mobile product card, `imageUrl` is more useful.

### Endpoint Organization

| Endpoint | W1 (furiosa) | W2 (nux) | W3 (slit) |
|----------|:---:|:---:|:---:|
| Trending | `/Product/trending` | `/Product/trending` or `?trending=true` | `?trending=true` or `/Product/trending` |
| Featured | `/Product/featured` | `?featured=true` or `/Product/featured` | `?featured=true` |
| Related | `/Product/{id}/related` | `/Product/{id}/related` or `?relatedTo=<id>` | `?relatedTo=<id>` or `/Product/{id}/related` |
| Card list | `X-View: card` header | `?view=card` | `?view=card` |

W2 and W3 support multiple routing patterns for the same endpoint (both path-based and query-param). W1 uses only path-based routing plus a header.

## config.yaml Comparison

| Worker | Has config.yaml | Content |
|--------|:---:|---------|
| W1 (furiosa) | Yes | `rest: true` (bare -- no schema/resource declarations) |
| W2 (nux) | **No** | Has `package.json` instead |
| W3 (slit) | Yes | `graphqlSchema`, `jsResource`, `rest: true` (complete) |

Only W3 has a proper, complete config.yaml. W1's bare config may work if Harper auto-discovers schema.graphql and resources.js in the same directory, but it's not explicit. W2's missing config is a deployment failure.

## Harper API Usage

| API | W1 | W2 | W3 |
|-----|:--:|:--:|:--:|
| `this.getContext()` | Y | Y | Y |
| `context.headers.get()` | Y | Y | Y |
| `context.responseHeaders.set()` | Y | Y | Y |
| `tables.X.search({ conditions })` | Y | Y | Y |
| `tables.X.get()` | Y | Y | Y |
| `tables.X.post()` | Y | Y | Y |
| `tables.X.put()` | Y | Y | Y |
| `tables.X.patch()` | Y | Y | Y |
| `target.get()` for query params | N (uses header) | Y | Y |
| `target.id` for path routing | Y | Y | Y |
| `for await` on search | N (uses `for...of`) | N (uses `for await`) | Y |
| `static loadAsInstance = false` | Y | Y | Y |

**All three workers discovered `this.getContext()` and `context.responseHeaders.set()`.** This is a significant improvement over the v1 run where furiosa never accessed the HTTP context layer. The v2 assignment's emphasis on headers (X-API-Key, X-RateLimit-*, Retry-After) forced all agents to find and use these APIs.

## Comparison to Tier 5v1

| Metric | v1 (ETags/Caching) | v2 (Auth/Rate Limiting) |
|--------|:---:|:---:|
| Pass rate | 2/3 | 2/3 |
| Failed worker | furiosa (W1) | nux (W2) |
| Failure type | Missing core feature (ETags) | Deployment packaging (wrong dir, no config) |
| Avg time (passing) | ~21 min | ~26 min |
| Fastest | furiosa (10 min, FAIL) | slit (17 min, PASS) |
| HTTP context usage | 2/3 | **3/3** |
| `context.responseHeaders.set()` | 1/3 | **3/3** |
| All criteria met in code | 2/3 | **3/3** |

**Key insight:** v2's failure mode is fundamentally different from v1's. In v1, furiosa didn't know how to implement the feature. In v2, nux implemented all the features correctly but failed on operational packaging (wrong directory name, missing config). The auth/rate-limiting requirements are more naturally header-oriented than ETags, which drove all three workers to discover the HTTP context APIs.

**All three workers produced functionally correct code for all 18 criteria.** This suggests the v2 variant is slightly easier to implement correctly than v1 (where furiosa completely omitted ETags). The difficulty in v2 is more about the volume of requirements (auth + 3 tiers + rate limiting + headers + fieldsets + view tracking + related + trending) rather than any single technically obscure feature.

## Recommendations

1. **nux's failure is operational, not intellectual.** The code is correct. The deployment is wrong. This suggests the bead instruction about target directory needs to be more prominent, or the `gt done` process should validate that files exist in the expected directory.

2. **Bronze tier field accuracy varies.** nux's Bronze tier leaks too many fields. The assignment should be more explicit: "Bronze: id, name, price, categoryId ONLY. All other fields must be stripped." Or provide a specific test case with expected output.

3. **Consider validating config.yaml in `gt done`.** Worker 2's missing config would prevent the component from loading. A pre-submission check could catch this: "Does config.yaml exist? Does it reference schema.graphql and resources.js?"

4. **The v2 variant successfully tests HTTP context APIs.** All 3 workers found `this.getContext()` and `context.responseHeaders.set()`, compared to only 2/3 in v1. The auth/rate-limiting requirements are better at driving HTTP context discovery than caching/ETags.

5. **slit is the standout performer.** Fastest completion (17 min), most complete schema (separate RateLimit table, per-key overrides, active flag), most thorough validation, proper config.yaml. In v1, slit was also a PASS. slit is the most reliable worker across both variants.

6. **Rate limiting architecture is a good design differentiator.** Three workers, three approaches (in-memory, on-record, separate table). Consider adding a follow-up question to the assignment: "What happens to your rate limits when the server restarts?" This would surface the in-memory approach's weakness.

7. **No test scripts from any worker.** Same as v1. Workers are not writing test scripts for this assignment. If verification scripts are desired, add them as an explicit deliverable.

## Artifacts

- Beads: dl-jqp0m (W1, PASS), dl-798ej (W2, FAIL), dl-s7v6c (W3, PASS)
- Branches: polecat/furiosa/dl-jqp0m@mlhhb6dg, polecat/nux/dl-798ej@mlhhc3ux, polecat/slit/dl-s7v6c@mlhhd1j7
- W1 dir: `.workers/worker-1/components/product-catalog/`
- W2 dir: `.workers/worker-2/components/data/` (WRONG -- should be `product-catalog/`)
- W3 dir: `.workers/worker-3/components/product-catalog/`
