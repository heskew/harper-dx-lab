# Tier 5 Iteration 1 Cohort Review: 2026-02-09

## Run Parameters

| Parameter | Value |
|-----------|-------|
| Tier | 5 — Caching, ETags & Performance |
| Assignment | tier-5-product-catalog.md |
| Harper Image | harperdb:v5-local |
| Expert Iteration | **1** (pitfalls.md with `this.getContext()` hint) |
| Workers | 3 |
| Convoy | hq-cv-4h4f4 |

## Result: 3/3 PASS

**Expert hint fixed the failure.** furiosa went from FAIL (iter 0) to PASS (iter 1) after receiving the `this.getContext()` / ETag pattern in the sling args. Confirms the iter 0 failure was purely a doc-discoverability problem.

## Iteration Comparison

| Metric | Iter 0 | Iter 1 | Delta |
|--------|:------:|:------:|:-----:|
| Pass rate | 2/3 (67%) | **3/3 (100%)** | +1 worker |
| furiosa result | **FAIL** | **PASS** | Fixed |
| furiosa time | ~10 min | ~9 min | ~Same |
| nux time | ~21 min | ~12 min | -9 min |
| slit time | ~21 min | ~12 min | -9 min |
| Avg time (all) | ~17 min | ~11 min | **-35%** |

**All three workers got faster.** The expert hints didn't just fix furiosa — they accelerated nux and slit by ~9 min each. Even workers who could already discover `this.getContext()` independently benefited from having it handed to them upfront.

## Workers

| Worker | Polecat | Bead | Time | Result | vs Iter 0 |
|--------|---------|------|------|--------|-----------|
| 1 | furiosa | dl-c1ft | ~9 min | PASS | **FAIL→PASS** |
| 2 | nux | dl-jzek | ~12 min | PASS | 21→12 min |
| 3 | slit | dl-ffpk | ~12 min | PASS | 21→12 min |

## Timeline

- 18:48 — Docker stacks created, beads slung with expert hints, convoy hq-cv-4h4f4 tracking
- 18:57 — furiosa (W1) completes `gt done` (~9 min)
- 18:58 — slit (W3) completes `gt done` (~10 min)
- 19:00 — nux (W2) completes `gt done` (~12 min)
- 19:00 — Convoy 3/3 COMPLETE

## Pass Criteria

| Criterion | W1 | W2 | W3 |
|-----------|:--:|:--:|:--:|
| Schema handles products, categories, and view tracking | Y | Y | Y |
| Products linked to categories via relationship | Y | Y | Y |
| GET product returns ETag or Last-Modified header | **Y** | Y | Y |
| Conditional GET with matching ETag returns 304 | **Y** | Y | Y |
| After product update, conditional GET returns 200 with new data | **Y** | Y | Y |
| Sparse fieldset support (card view vs full detail) | Y | Y | Y |
| Related products endpoint returns products in same category | Y | Y | Y |
| View tracking implemented without slowing reads | Y | ~Y | ~Y |
| Trending/popular products endpoint based on view counts | Y | Y | Y |
| Cache invalidation works — updates reflect within seconds | **Y** | Y | Y |
| No Express/Fastify/external frameworks | Y | Y | Y |
| No Redis/external cache | Y | Y | Y |
| No SQL | Y | Y | Y |
| Uses Harper Resource class for custom behavior | Y | Y | Y |

**Bold** marks criteria that furiosa failed in iter 0 and now passes.

## The Fix: What Changed for furiosa

### Iter 0 (FAIL) — 147 lines, 5 classes
```
Product, ProductCard, ProductView, Trending, RelatedProducts
- No this.getContext()
- No ETag, no 304, no Cache-Control
- Separate endpoints for each concern
- View tracking via separate POST /ProductView/
```

### Iter 1 (PASS) — 243 lines, 2 classes
```
Category, Product
- this.getContext() ✓
- ETag via generateETag(record) ✓
- 304 via { status: 304, headers: { 'ETag': etag } } ✓
- Cache-Control: max-age=60, must-revalidate ✓
- Consolidated query param + path routing
- Fire-and-forget view tracking inline on GET
- ?view=full includes relatedProducts
```

furiosa didn't just bolt ETags onto the old architecture — it **completely redesigned** from 5 small Resource classes to 2 consolidated classes. The expert hint gave it the HTTP-layer API, and it rebuilt everything around that capability. Lines went from 147 to 243 (+65%).

### What specifically the hint unlocked

The pitfalls.md provided:
1. `this.getContext()` — how to access the HTTP context
2. `context.headers.get('if-none-match')` — how to read request headers
3. `return { status: 304, headers: { 'ETag': ... } }` — how to return custom HTTP responses

With these three pieces, furiosa implemented:
- ETag generation from `updatedAt` timestamps
- Conditional request handling with 304
- Cache-Control headers
- Structured response objects with `{ status, headers, data }`

**Verdict: The iter 0 failure was 100% doc-discoverability.** furiosa had the architectural capability all along — it just couldn't find the API.

## Schema Comparison (Iter 0 → Iter 1)

### Worker 1 (furiosa) — Changed

| Aspect | Iter 0 | Iter 1 |
|--------|--------|--------|
| ProductView pattern | Individual records (viewedAt) | **Counter** (viewCount, lastViewedAt) |
| `sku` field | Yes | No |
| `tags` field | Yes (@indexed) | Yes (no @indexed) |

furiosa switched from individual view records to the counter pattern (same as iter 0 nux). The expert hint influenced the overall design approach, not just the ETag part.

### Worker 2 (nux) — Identical schema to iter 0

Same Category, Product, ProductView tables. No changes.

### Worker 3 (slit) — Identical schema to iter 0

Same Category, Product (with viewCount), ProductView tables. No changes.

## Resources.js Analysis

### Worker 1 (furiosa) — Complete Rewrite

**Architecture shift:** Many-small-endpoints → consolidated query-param router. Now matches the pattern nux used in iter 0.

Key features in iter 1:
- `this.getContext()` for HTTP header access ✓
- `generateETag()` based on `updatedAt || createdAt` (same strategy as nux)
- `{ status: 304, headers: {...} }` for conditional requests ✓
- `Cache-Control: max-age=60, must-revalidate` ✓
- `this.trackView(record.id).catch(() => {})` — fire-and-forget ✓
- `?view=card` / `?view=full` with related products inline
- `?trending=true` AND `/Product/trending` (dual routing)
- `?relatedTo=<id>` AND `/Product/<id>/related` (dual routing)
- `?featured=true` filter
- viewCount fetched from ProductView and included in response

**Notable:** furiosa now implements BOTH query-param routing AND path-based routing for trending and related products. This is the most flexible routing of any worker across both iterations.

### Worker 2 (nux) — Minor Evolution

Nearly identical to iter 0. Key differences:
- View tracking: **now awaited** (was fire-and-forget `.catch(() => {})` in iter 0)
- Added `?view=card` for collections — uses `search({ limit: 1000 })` then maps to card view
- Same ETag strategy, same query-param routing

**Regression note:** nux's view tracking went from fire-and-forget (iter 0) to awaited (iter 1). The expert hint said "ETags are HARD REQUIREMENTS" which may have prompted nux to be more conservative, awaiting everything. This technically slows reads.

### Worker 3 (slit) — Identical to Iter 0

Same code, byte-for-byte effectively identical. Same MD5 content-hash ETag, same path routing, same `context.responseHeaders.set()`, same `target.delete('view')`. The expert hints had no effect on slit's implementation because slit already knew everything in the pitfalls doc.

## Cross-Iteration Architecture Convergence

| Pattern | Iter 0 W1 | Iter 0 W2 | Iter 0 W3 | Iter 1 W1 | Iter 1 W2 | Iter 1 W3 |
|---------|:---------:|:---------:|:---------:|:---------:|:---------:|:---------:|
| Resource classes | 5 | 2 | 2 | **2** | 2 | 2 |
| Routing style | Separate endpoints | Query params | Path-based | **Query + Path** | Query params | Path-based |
| ETag strategy | None | Timestamp | Content hash | **Timestamp** | Timestamp | Content hash |
| View tracking | Separate POST | Fire-forget | Awaited | **Fire-forget** | Awaited* | Awaited |
| `this.getContext()` | No | Yes | Yes | **Yes** | Yes | Yes |

*nux regressed from fire-forget to awaited in iter 1.

The expert hint caused **convergence**: furiosa adopted the consolidated 2-class pattern and timestamp-based ETags — essentially converging toward nux's iter 0 architecture. The hint didn't just teach an API; it taught a design pattern.

## ETag Strategies

Two distinct strategies emerged across both iterations:

### Timestamp-based (W1, W2)
```js
function generateETag(record) {
    return `"${record.updatedAt || record.createdAt || Date.now()}"`;
}
```
**Pros:** Simple, no extra computation. **Cons:** Any field change (including viewCount) changes updatedAt, which invalidates the ETag. Requires viewCount to be on a separate table.

### Content-hash (W3)
```js
function computeETag(data) {
    const content = extractContentFields(data);  // excludes viewCount, timestamps
    return '"' + crypto.createHash('md5').update(JSON.stringify(content)).digest('hex') + '"';
}
```
**Pros:** Only invalidates when actual content changes. View tracking doesn't affect cache. **Cons:** Requires crypto import, more CPU per request.

W3's approach is architecturally superior for this specific use case (high-read product catalog with view tracking), but W1/W2's approach is simpler and works correctly when viewCount lives on a separate table.

## Expert Knowledge Effectiveness

### Quantified Impact

| Metric | Without Hints (Iter 0) | With Hints (Iter 1) |
|--------|:----------------------:|:-------------------:|
| Pass rate | 67% | **100%** |
| Avg completion time | 17.3 min | **11.0 min** |
| Time saved per worker | — | **6.3 min avg** |
| Failed criteria | 4 (W1) | **0** |
| Workers needing redesign | 0 | 1 (W1, improved) |

### Cost-Benefit

The pitfalls.md file is 30 lines. It:
- Fixed 1 failure (furiosa)
- Saved ~19 min of total worker time across 3 workers
- Required zero additional expert intervention
- Didn't cause any regressions in passing workers (nux/slit still pass)

**ROI: 30 lines of expert knowledge → 100% pass rate recovery + 35% time reduction.**

### What the Hint Taught vs What Was Already Known

| Capability | Already knew (iter 0) | Learned from hint (iter 1) |
|------------|:---------------------:|:--------------------------:|
| Schema design | All 3 | — |
| Resource class extension | All 3 | — |
| Validation in post() | All 3 | — |
| tables.X.search() | All 3 | — |
| target.get() for query params | 2/3 | — |
| `this.getContext()` | 2/3 | **furiosa** |
| `context.headers.get()` | 2/3 | **furiosa** |
| `{ status: 304, headers }` pattern | 2/3 | **furiosa** |
| `context.responseHeaders.set()` | 1/3 | — (not in hint) |

The hint's scope was precisely targeted — it taught exactly the API that was missing. slit's `context.responseHeaders.set()` knowledge wasn't in the hint and wasn't needed for passing.

## Recommendations

1. **Expert iteration system validated.** 30 lines of targeted knowledge turned a 67% pass rate into 100% and cut average time by 35%. The feedback loop works.

2. **Promote pitfalls.md to Harper docs.** The `this.getContext()` / ETag pattern should be a first-class example in the Harper Resource class documentation. It's the single highest-impact doc addition identified in the DX Lab.

3. **Consider iter 2 with `context.responseHeaders.set()`.** Only slit discovered this API. Adding it to the pitfalls doc could further improve the quality of ETag implementations (setting headers on the context vs returning them in the response object).

4. **Watch for regressions.** nux's view tracking went from fire-and-forget to awaited between iterations. Expert hints can cause unexpected conservatism. Consider adding "fire-and-forget pattern: `promise.catch(() => {})` keeps the read path fast" to the hints.

5. **Architecture convergence is a signal.** With the hint, furiosa converged toward nux's design. Without it, furiosa invented a completely different (5-class) architecture. Hints don't just teach APIs — they shape architectural decisions.

## Artifacts

- Convoy: hq-cv-4h4f4
- Beads: dl-c1ft (W1), dl-jzek (W2), dl-ffpk (W3)
- Component dirs: `.workers/worker-{1,2,3}/components/product-catalog/`
- Expert knowledge: `expert-knowledge/iteration-1/pitfalls.md`
- Previous iteration review: `reviews/tier5-cohort-2026-02-09.md`
