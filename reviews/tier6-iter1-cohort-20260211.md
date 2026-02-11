# Tier 6 Iter 1 Cohort Review: 2026-02-11

## Run Parameters

| Parameter | Value |
|-----------|-------|
| Tier | 6 — Capstone: Event Ticketing System |
| Assignment | tier-6-event-ticketing.md |
| Expert Iteration | 1 (with iter-3 pitfall hints) |
| Workers | 3 |
| Polecats | furiosa (W1), nux (W2), slit (W3) |

### Expert Hints Provided

1. `getContext()` for HTTP headers
2. `tables.X.publish()` for MQTT (not bare `publish()`)
3. TOCTOU race condition warning for seat booking (acknowledge as platform limitation, don't try to build locks)
4. Harper handles ETags automatically
5. Lazy expiry pattern for seat holds
6. PATCH merges, PUT replaces
7. `config.yaml` not `package.json`

## Result: 3/3 PASS

All three workers produced complete, deployable implementations. All three submissions are reviewable with artifacts present in `.workers/` directories.

## Summary

| Worker | Polecat | Bead | Branch | Time | Result |
|--------|---------|------|--------|------|--------|
| 1 | furiosa | dl-wvpup | polecat/furiosa/dl-wvpup@mli3nl8q | ~38 min | **PASS** |
| 2 | nux | dl-8p30p | polecat/nux/dl-8p30p@mli3oncb | ~20 min | **PASS** |
| 3 | slit | dl-ci769 | polecat/slit/dl-ci769@mli3pv5w | ~30 min | **PASS** |

## Pass Criteria

| Criterion | W1 (furiosa) | W2 (nux) | W3 (slit) |
|-----------|:---:|:---:|:---:|
| Data model: events, venues, sections, seats, purchases | Y | Y | Y |
| Seat inventory individually tracked (no overselling) | Y | Y | Y |
| Seat hold mechanism with auto-timeout release | Y | Y | Y |
| Hold expiry works (seats become available again) | Y | Y | Y |
| Browse API with filtering (date, venue, category) | Y | Y | Y |
| Event detail: availability by section with pricing | Y | Y | Y |
| Waitlist — join when sold out | Y | Y | Y |
| Waitlist notification when seats open (real-time) | **Y** | **Y** | **Y** |
| Concurrent checkout safety (no double-sell) | ~Y | ~Y | ~Y |
| Cache strategy for browse/listing | Y | Y | Y |
| No Express/Fastify | Y | Y | Y |
| No Redis/external cache | Y | Y | Y |
| No SQL | Y | Y | Y |
| Uses Harper Resource class | Y | Y | Y |
| All in one Harper runtime | Y | Y | Y |

### Expert Hint Adoption

| Hint | W1 (furiosa) | W2 (nux) | W3 (slit) |
|------|:---:|:---:|:---:|
| `getContext()` for HTTP headers | Y | Y | Y |
| `tables.X.publish()` for MQTT | **Y** | **Y** | **Y** |
| TOCTOU acknowledged in comments | **Y** | **Y** | **Y** |
| Lazy expiry pattern | **Y** | **Y** | **Y** |
| `config.yaml` (not package.json) | Y | Y | Y |

**All five actionable hints were adopted by all three workers.** This is the primary finding of this iteration.

---

## Per-Worker Analysis

### Worker 1 (furiosa) — 632 lines, 7 tables, 7 Resource classes

**Branch:** `polecat/furiosa/dl-wvpup@mli3nl8q`
**Time:** ~38 min (slowest)

#### Schema: 7 tables

```
Venue, Section, Event, EventSeat, SeatHold, Purchase, WaitlistEntry
```

| Table | Key Design Decisions |
|-------|---------------------|
| Venue | name, city, state @indexed, capacity |
| Section | venueId @indexed, rowCount, seatsPerRow, price on Section |
| Event | category, venueId, date @indexed, status @indexed |
| **EventSeat** | eventId, sectionId, row, seatNumber, status, holdId, purchaseId, price |
| **SeatHold** | eventId, userId, seatIds[], expiresAt, status |
| Purchase | eventId, userId, seatIds[], totalPrice, status |
| WaitlistEntry | eventId, userId, status |

**Notable:** furiosa introduced a dedicated `SeatHold` table — a separate entity tracking hold state with its own lifecycle (`active` -> `expired` -> `completed`). This is the only worker with an explicit hold record. The `EventSeat` table also stores `price` per seat (denormalized from Section), and `holdId` links back to the SeatHold record.

#### Architecture

- **Two-entity hold model:** SeatHold record + EventSeat status. Hold creation writes to both: creates SeatHold record, then patches each EventSeat to `held` with the holdId. This provides auditability — you can query hold history.
- **Lazy expiry:** `getEffectiveSeatStatus()` checks seat -> hold -> `isHoldExpired(hold)` -> `expireHold()`. The chain is: read seat, read its SeatHold, check expiry, cascade release. Called on every seat read.
- **MQTT:** `tables.WaitlistEntry.publish('waitlist/${eventId}', {...})` — correct pattern. Called when holds expire or are explicitly deleted.
- **TOCTOU:** Comment on line 409: _"Harper does not have atomic conditional writes. A TOCTOU race window exists where two concurrent requests could both read seats as 'available' before either writes 'held'. This is a known platform limitation."_
- **Cache:** In-memory `Map` with 60s TTL. Keys by filter params. `X-Cache: HIT/MISS` header. `Cache-Control: public, max-age=60` on browse responses.
- **Hold-to-purchase flow:** Purchase requires a holdId. Verifies hold belongs to user, not expired, re-checks each seat is still held by this hold. Then creates Purchase, marks seats sold, marks hold completed.
- **Seat initialization:** On event POST, iterates all venue sections and creates individual EventSeat records for every row/seat combination. Awaits completion.
- **Event sold-out detection:** After purchase, `checkAndUpdateEventStatus()` scans all event seats; if none are available, patches event status to `sold_out`.

#### Strengths

- **Most thorough hold model.** Dedicated SeatHold entity gives full lifecycle tracking. You can query active holds, expired holds, completed holds.
- **Input validation** across all endpoints — 400/403/404/409/410 responses with descriptive messages.
- **Hold deletion endpoint** (DELETE /SeatHold/:id) that triggers seat release and waitlist notification.
- **Duplicate waitlist prevention** — searches for existing entries before creating.
- **Event detail** enriched with venue info and full section availability breakdown.

#### Weaknesses

- **Slowest at 38 min.** The two-entity hold model adds complexity without functional benefit vs. storing hold state on the seat itself.
- **Double read on seat during purchase:** Reads all seats to verify holds (lines 515-520), then reads them AGAIN to sum prices (lines 524-527). Could combine into one pass.
- **Price on Section (not per-event).** Denormalizes to EventSeat.price at creation time, but there's no EventSection join table for per-event pricing.
- **No `BrowseCache` table in schema** — uses only in-memory Map. Schema declares exactly the tables needed, no extras.

---

### Worker 2 (nux) — 509 lines, 8 tables, 8 Resource classes

**Branch:** `polecat/nux/dl-8p30p@mli3oncb`
**Time:** ~20 min (fastest)

#### Schema: 8 tables

```
Venue, Section, Event, EventSection, Seat, Purchase, PurchaseSeat, Waitlist
```

| Table | Key Design Decisions |
|-------|---------------------|
| Venue | name, city @indexed |
| Section | venueId @indexed, rows, seatsPerRow |
| Event | venueId, category, date @indexed, status, onSaleDate |
| **EventSection** | eventId, sectionId, **price** — per-event pricing join table |
| Seat | eventId, sectionId, row (String), seatNumber, status, holdUserId, holdExpiresAt, purchaseId |
| Purchase | eventId, userId, totalPrice, status |
| **PurchaseSeat** | purchaseId, seatId, eventId, sectionId, price — per-seat purchase line item |
| Waitlist | eventId, userId, email, notified |

**Notable:** nux is the only worker with BOTH an EventSection join table (per-event pricing) AND a PurchaseSeat line item table. This is the most normalized, production-grade schema of the three. Price lives on EventSection (not Section), so the same venue section can have different prices for different events.

#### Architecture

- **Hold on seat directly:** No separate hold table. Seat fields: `status`, `holdUserId`, `holdExpiresAt`. Hold via `POST /Seat/ {action: 'hold'}`. Simpler than W1's two-entity model.
- **Lazy expiry:** `releaseIfExpired(seat)` checks `status === 'held' && holdExpiresAt < Date.now()`, patches to available, calls `notifyWaitlist()`. Applied on every seat read.
- **MQTT:** `tables.Waitlist.publish('waitlist/${eventId}', notification)` — correct pattern. Called on hold expiry AND manual seat release.
- **TOCTOU:** Two separate comments — line 276 in holdSeats: _"TOCTOU race -- Harper lacks atomic conditional writes"_ and line 429 in Purchase.post: _"TOCTOU race between validation above and writes below"_.
- **Cache:** HTTP `Cache-Control` headers only — `max-age=30, stale-while-revalidate=60` on browse, `max-age=10, stale-while-revalidate=30` on event detail. No in-memory cache. Delegates to client/CDN caching.
- **Action-based routing:** `POST /Seat/ {action: 'hold'}` and `{action: 'release'}`. Same POST endpoint, dispatched by action field.
- **Batch hold with rollback:** If any seat in a hold batch fails, rolls back all previously held seats in the batch. Only worker with explicit rollback logic.
- **Purchase creates line items:** POST /Purchase/ creates a Purchase record + individual PurchaseSeat records per seat, looking up price from EventSection. Most complete purchase model.

#### Strengths

- **Fastest at 20 min** with the most complete data model. Exceptional efficiency.
- **Best schema design.** EventSection for per-event pricing + PurchaseSeat for purchase line items. This is the correct production model.
- **Hold rollback.** If seat 3 of 4 fails to hold, rolls back seats 1-2. Only worker that handles partial batch failures gracefully.
- **Direct purchase of available seats** allowed (not just held seats). More flexible checkout flow.
- **`httpError()` utility** with statusCode for clean error throwing via Resource class conventions.
- **`onSaleDate` field** on Event — only worker modeling when tickets go on sale.

#### Weaknesses

- **No in-memory cache.** Relies entirely on HTTP `Cache-Control` and `stale-while-revalidate`. Fine for CDN-fronted production, but the assignment says "cache strategy for browse/listing" — HTTP headers count, though in-memory would be more demonstrative.
- **No `getContext()` for browse filters.** Uses `target.get('category')` etc. instead of HTTP headers. This is actually correct for query parameters, but means filters come via query string, not custom headers. Valid approach.
- **PurchaseSeat Resource class** is empty — just extends base. Functional but no custom logic.

---

### Worker 3 (slit) — 689 lines, 7 tables (+1 BrowseCache), 7 Resource classes

**Branch:** `polecat/slit/dl-ci769@mli3pv5w`
**Time:** ~30 min

#### Schema: 7 tables + BrowseCache

```
Venue, Section, Event, Seat, Purchase, Waitlist, BrowseCache
```

| Table | Key Design Decisions |
|-------|---------------------|
| Venue | name, city @indexed, capacity, sections relationship |
| Section | venueId, name, totalRows, seatsPerRow, **priceInCents** (Int), sortOrder, bidirectional relationships |
| Event | venueId, category, date @indexed, status, venue relationship |
| Seat | eventId, sectionId, row, seatNumber, status, holdExpiry, holderId, purchaseId, bidirectional relationships |
| Purchase | eventId, userId, seatIds[], **totalPriceInCents** (Int), status, event relationship |
| Waitlist | eventId, userId, email, notified |
| **BrowseCache** | data (String), cachedAt — declared in schema but unused in code |

**Notable:** slit uses `priceInCents` (Int) instead of `price` (Float) — the correct money representation pattern to avoid floating point precision issues. This is the only worker modeling money correctly. Also the richest relationship graph: Venue->sections, Section->venue/seats, Event->venue, Seat->event/section, Purchase->event.

#### Architecture

- **Hold on seat directly:** Like W2, no separate hold table. Fields: `holdExpiry`, `holderId` on Seat. Hold via `POST /Seat/ {action: 'hold'}`.
- **Lazy expiry:** `expireHoldIfNeeded(seat)` checks `status === 'held' && holdExpiry < Date.now()`, patches to available, calls `notifyWaitlist()`, re-reads from DB. Called on every seat access including collection listing.
- **MQTT:** `tables.Waitlist.publish('waitlist/event/${eventId}', {...})` — correct pattern. Called on hold expiry, manual seat release, AND when users join the waitlist (publishes `waitlist_joined` event).
- **TOCTOU:** Two separate comments — line 407 in holdSeats: _"Harper does not have atomic conditional writes. This read-check-write is vulnerable to TOCTOU race conditions. This is acknowledged as a platform limitation."_ and line 533 in Purchase.post.
- **Cache:** In-memory `Map` with 30s TTL + prefix-based invalidation. Caches browse results by filter composite key. Invalidates on event mutations, seat holds/releases, and purchases.
- **Sold-out detection:** `checkSoldOut()` scans for available seats, also checks held seats for expired holds before declaring sold out. More thorough than W1.
- **Section sort order:** `sortOrder` field on Section with `sort: { attribute: 'sortOrder' }` in queries. Only worker providing deterministic section ordering.
- **x-request-id header:** Event GET adds `x-request-id: UUID` to every response. Useful for debugging/tracing.

#### Strengths

- **Money in cents.** `priceInCents: Int` avoids floating point issues. Only correct money representation in the cohort.
- **Richest relationships.** Bidirectional `@relationship` annotations across all related tables. Schema is self-documenting.
- **`sortOrder` on Section.** Deterministic ordering in venue seat maps. Production-quality detail.
- **Waitlist join notification.** Publishes MQTT when a user joins the waitlist (not just when seats open). Enables real-time waitlist size tracking.
- **BrowseCache table** in schema (even though unused in code) shows the worker considered DB-backed caching. The in-memory implementation is the pragmatic choice.
- **Cache invalidation on seat operations.** `invalidateCache('events:')` called in holdSeats and releaseSeats, not just on event/purchase mutations. Most aggressive invalidation strategy.

#### Weaknesses

- **Price on Section (not per-event).** Like W1, no EventSection join table. The same section has the same price for all events. Simpler but less flexible than W2.
- **No purchase line items.** Stores `seatIds[]` array on Purchase, but no per-seat price breakdown. If section prices change, historical purchase amounts become unrecoverable per-seat.
- **BrowseCache table unused.** Declared in schema but never referenced in code. Dead schema definition.
- **No hold rollback.** Unlike W2, if seat 3 of 4 fails to hold, seats 1-2 remain held. Reports partial success via `held`/`failed` arrays, which is a valid but different strategy (partial holds vs. all-or-nothing).

---

## Cross-Worker Comparison

### Architectural Patterns

| Aspect | W1 (furiosa) | W2 (nux) | W3 (slit) |
|--------|:---:|:---:|:---:|
| Lines | 632 | 509 | 689 |
| Tables | 7 | 8 | 7 (+1 unused) |
| Resource classes | 7 | 8 | 7 |
| Hold model | **SeatHold entity + Seat status** | Seat fields only | Seat fields only |
| Hold routing | POST /SeatHold/ | POST /Seat/ {action: hold} | POST /Seat/ {action: hold} |
| Pricing model | Section.price (denormalized to seat) | **EventSection join** | Section.priceInCents |
| Money type | Float | Float | **Int (cents)** |
| Purchase line items | No | **Yes (PurchaseSeat)** | No |
| Cache type | In-memory Map (60s TTL) | **HTTP headers only** | In-memory Map (30s TTL) |
| Hold batch failure | Reject all | **Rollback held seats** | Partial success (report both) |
| MQTT pattern | tables.WaitlistEntry.publish() | tables.Waitlist.publish() | tables.Waitlist.publish() |
| TOCTOU comments | 1 comment | 2 comments | 2 comments |
| Lazy expiry | Yes (via SeatHold lookup) | Yes (direct on seat) | Yes (direct on seat) |
| Sold-out detection | Yes | No | Yes (more thorough) |
| Event seat initialization | On event create | Manual | Manual |
| Relationships | Minimal | Forward only | **Rich bidirectional** |
| getContext() usage | 7 calls | 2 calls | 2 calls |

### Common Patterns (3/3 workers)

1. **Lazy hold expiry on read.** All three check hold expiry on every seat access and release expired holds inline. None use batch scanners or background jobs. This directly reflects the expert hint.
2. **`tables.X.publish()` for MQTT.** All three use the correct Harper MQTT pattern. Zero bare `publish()` calls. Direct fix from the expert hint.
3. **TOCTOU acknowledgment in comments.** All three explicitly document the race condition as a platform limitation. Direct response to the expert hint.
4. **`config.yaml` for component configuration.** All three use the same pattern: `graphqlSchema`, `jsResource`, `rest: true`. No package.json files.
5. **Action-based seat operations.** W2 and W3 use `POST /Seat/ {action: 'hold'|'release'}`. W1 uses dedicated SeatHold resource but same concept.
6. **Duplicate waitlist prevention.** All three check for existing entries before creating a new waitlist record.

### Divergent Approaches

| Decision | Workers | Analysis |
|----------|---------|----------|
| Dedicated hold table vs. seat fields | W1 vs. W2/W3 | W1's approach gives hold history and auditability. W2/W3's approach is simpler and faster. For a real ticketing system, W1's model is better for ops (debugging hold issues) but W2/W3's model is better for performance. |
| EventSection join vs. flat price | W2 vs. W1/W3 | W2 is architecturally correct. The same venue section should have different prices for different events. W1/W3's approach works for single-use venues but breaks for shared venues. |
| In-memory cache vs. HTTP headers | W1/W3 vs. W2 | W1/W3 cache query results in process memory. W2 sets Cache-Control/stale-while-revalidate headers. Both are valid strategies. W2's approach is more appropriate for distributed systems; W1/W3's approach gives more control. |
| All-or-nothing vs. partial holds | W2 vs. W3 | W2 rolls back on partial failure. W3 returns partial success. W2's approach is more transactional. W3's approach is more lenient (you get what's available). |
| Money representation | W3 vs. W1/W2 | W3 uses `Int` (cents). W1/W2 use `Float` (dollars). W3 is correct for financial systems. |

### Notable Techniques

- **W1:** SeatHold lifecycle state machine (`active` -> `expired` -> `completed`). Only worker with explicit hold state separate from seat state.
- **W2:** Hold rollback on partial batch failure. PurchaseSeat line items with per-seat price at time of purchase. `onSaleDate` field.
- **W3:** `priceInCents` integer money. `sortOrder` on sections. `x-request-id` tracing header. MQTT publish on waitlist join (not just seat release).

---

## Comparison with Iter 0 (2026-02-09)

### Iter 0 Recap

- 3 workers, 2 reviewable (W3/slit lost to infra bug)
- Both reviewable submissions: **conditional PASS**
- W1 (furiosa) used bare `publish()` for MQTT -- broken
- W2 (nux) used `tables.WaitlistAlert.publish()` -- correct
- Both hit TOCTOU but neither acknowledged it explicitly in code
- W2 (nux) used ETag-based caching; W1 (furiosa) used in-memory cache
- Average time: ~13 min

### Iter 0 vs Iter 1

| Metric | Iter 0 | Iter 1 | Change |
|--------|--------|--------|--------|
| Reviewable submissions | 2/3 | **3/3** | Infra fixed |
| Pass rate (of reviewable) | 2/2 (conditional) | **3/3 (clean)** | Conditions resolved |
| MQTT correct | 1/2 (50%) | **3/3 (100%)** | Expert hint worked |
| TOCTOU acknowledged | 0/2 (0%) | **3/3 (100%)** | Expert hint worked |
| Lazy expiry pattern | 1/2 (50%) | **3/3 (100%)** | Expert hint worked |
| config.yaml (not package.json) | 2/2 (100%) | 3/3 (100%) | No change needed |
| Avg time | ~13 min | **~29 min** | +16 min |
| Avg lines | ~404 | **610** | +51% |
| Avg tables | 7 | **7.3** | Slight increase |

### Key Differences

**1. MQTT: 100% correct (was 50%).** The `tables.X.publish()` hint eliminated the bare `publish()` antipattern entirely. In iter 0, furiosa's waitlist notification was broken. In iter 1, all three workers use the correct pattern. This was the highest-impact hint.

**2. TOCTOU: 100% acknowledged (was 0%).** In iter 0, both workers implemented read-check-write patterns but neither explicitly documented the race condition. In iter 1, all three include inline `NOTE:` comments explaining TOCTOU as a Harper platform limitation. W2 and W3 each have two separate TOCTOU comments (hold and purchase). The hint to "acknowledge as platform limitation, don't try to build locks" was followed precisely -- no worker attempted mutexes or retries.

**3. Lazy expiry: 100% adopted (was 50%).** In iter 0, furiosa used a batch scanner (`releaseExpiredHolds(eventId)` scanning all held seats). nux used lazy per-seat expiry. In iter 1, all three use the lazy pattern: check expiry on every seat access, release inline. furiosa switched from batch scanning to lazy.

**4. Time nearly doubled.** Average completion time increased from ~13 min to ~29 min. The implementations are significantly more thorough: more tables (PurchaseSeat, SeatHold), better validation, more TOCTOU comments, richer relationships, hold rollback logic. The hints gave workers more to implement correctly rather than skip.

**5. No ETags in iter 1.** In iter 0, nux implemented manual ETag generation with `If-None-Match` and 304 responses. In iter 1, no worker implements manual ETags. The hint "Harper handles ETags automatically" may have caused workers to skip ETag implementation entirely, relying on Harper's built-in behavior. W2 (nux) switched to `Cache-Control` + `stale-while-revalidate` headers instead. This is a reasonable interpretation of the hint but worth noting -- the explicit ETag handling from iter 0 was technically more complete for the "cache strategy" criterion.

**6. Conditional PASS -> clean PASS.** Iter 0's two passes were conditional: furiosa's broken MQTT and both workers' undocumented TOCTOU. Iter 1 resolves both conditions. All three workers pass all 15 criteria without caveats (TOCTOU remains a platform limitation but is now properly acknowledged).

### Same Polecats, Different Results

This iteration uses the same three polecats (furiosa, nux, slit). Direct comparison of returning workers:

**furiosa (W1):** iter 0 had broken MQTT (bare `publish()`), batch hold scanner, no TOCTOU comment. iter 1 fixes all three: correct `tables.WaitlistEntry.publish()`, lazy expiry, explicit TOCTOU note. Added a dedicated SeatHold entity (new design choice). Time increased from ~13 min to ~38 min.

**nux (W2):** iter 0 was the strongest submission (correct MQTT, ETags, lazy expiry). iter 1 maintains quality but changes approach: drops manual ETags for HTTP cache headers, adds EventSection join table + PurchaseSeat line items (richer data model), adds hold rollback logic. Time increased from ~13 min to ~20 min.

**slit (W3):** iter 0 was lost to infra bug. iter 1 is the first reviewable submission. Strong showing: money-in-cents, bidirectional relationships, section sort order, MQTT on waitlist join. 30 min.

---

## Overall Cohort Assessment

### The Expert Hints Worked

This is the clearest evidence yet that targeted expert hints produce measurable improvements in agent output quality. The three highest-priority hints -- `tables.X.publish()`, TOCTOU acknowledgment, and lazy expiry -- went from partial/zero adoption in iter 0 to 100% adoption in iter 1. The hints didn't just fix bugs; they changed architectural decisions (batch scanning -> lazy expiry) and established documentation practices (inline TOCTOU comments).

### Time-Quality Tradeoff

The average completion time nearly doubled (13 min -> 29 min), but the quality improvement is substantial. The iter 1 submissions are more correct (working MQTT), more honest (TOCTOU documented), and more production-grade (lazy expiry, better validation, richer schemas). The extra time went to real improvements, not busy-work.

### Schema Sophistication Increased

Iter 0 produced 7-table schemas. Iter 1 ranges from 7 to 8 tables with more thoughtful design:
- W2's EventSection + PurchaseSeat is a genuinely better data model
- W3's priceInCents is the only correct money representation across both iterations
- W1's SeatHold entity adds auditability not present in iter 0

### The ETag Question

The hint "Harper handles ETags automatically" may have been counterproductive for the caching criterion. In iter 0, nux implemented rich ETag handling (generateETag, If-None-Match, 304 responses). In iter 1, no worker implements manual ETags. All three still pass the caching criterion through in-memory caches or HTTP Cache-Control headers, but the explicit ETag pattern from iter 0 was arguably a more sophisticated cache strategy. Consider whether this hint should be reworded to clarify that Harper's automatic ETags are sufficient and don't need manual implementation, without discouraging workers from adding ETag-aware logic.

### Recommendations

1. **Tier 6 iter 1 confirms the expert hint model.** 3/3 PASS with zero caveats, up from 2/2 conditional PASS. The hints resolve the exact issues identified in iter 0.

2. **Consider reducing hints for iter 2.** All five hints were adopted by all three workers. Test whether fewer hints (e.g., just MQTT and TOCTOU) produce the same quality improvement while preserving more independent problem-solving.

3. **nux remains the strongest polecat for Tier 6.** Fastest (20 min), best schema (EventSection + PurchaseSeat), only worker with hold rollback. Consistently strong across both iterations.

4. **slit's first reviewable Tier 6 is solid.** After being lost to infra in iter 0, slit produced the most lines of code (689), correct money representation (priceInCents), and the richest relationship graph. Worth monitoring in future iterations.

5. **furiosa's SeatHold entity is interesting but costly.** The dedicated hold table adds auditability but doubles the writes per hold operation and adds latency. furiosa's 38 min (vs. nux's 20 min) suggests the complexity wasn't free. The simpler model (hold state on seat) is sufficient for the assignment's requirements.

## Artifacts

- Beads: dl-wvpup (W1), dl-8p30p (W2), dl-ci769 (W3)
- Branches: polecat/furiosa/dl-wvpup@mli3nl8q, polecat/nux/dl-8p30p@mli3oncb, polecat/slit/dl-ci769@mli3pv5w
- Component dirs: `.workers/worker-{1,2,3}/components/event-ticketing/`
- Prior iteration review: `reviews/tier6-cohort-2026-02-09.md`
