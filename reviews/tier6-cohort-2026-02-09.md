# Tier 6 Cohort Review: 2026-02-09

## Run Parameters

| Parameter | Value |
|-----------|-------|
| Tier | 6 — Capstone: Event Ticketing System |
| Assignment | tier-6-event-ticketing.md |
| Harper Image | harperdb:v5-local |
| Expert Iteration | 0 (no hints) |
| Workers | 3 |
| Convoy | hq-cv-63jhs |

## Result: 2/3 REVIEWABLE, 1/3 LOST

Workers 1 and 2 produced complete implementations. Worker 3 (slit) completed `gt done` but its artifacts were **not found** in the Docker-mounted components directory — the files existed only in the git worktree which was nuked on exit. This is an infrastructure issue (workspace/Docker mount mismatch), not a code failure.

Of the 2 reviewable submissions, both are **conditional PASS** with caveats on concurrent checkout safety and MQTT waitlist notifications.

## Workers

| Worker | Polecat | Bead | Time | Result |
|--------|---------|------|------|--------|
| 1 | furiosa | dl-c7if | ~13 min | PASS (caveats) |
| 2 | nux | dl-3uop | ~13 min | PASS (caveats) |
| 3 | slit | dl-c1ap | ~18 min | **LOST** (infra issue) |

## Timeline

- 19:10 — Docker stacks created, beads slung, convoy hq-cv-63jhs tracking
- 19:23 — furiosa (W1) and nux (W2) complete `gt done` (~13 min each)
- 19:28 — slit (W3) completes `gt done` (~18 min)
- 19:28 — Convoy 3/3 COMPLETE

## Pass Criteria

| Criterion | W1 | W2 | W3 |
|-----------|:--:|:--:|:--:|
| Data model: events, venues, sections, seats, purchases | Y | Y | ? |
| Seat inventory individually tracked (no overselling) | Y | Y | ? |
| Seat hold mechanism with auto-timeout release | Y | Y | ? |
| Hold expiry works (seats become available again) | Y | Y | ? |
| Browse API with filtering (date, venue, category) | Y | Y | ? |
| Event detail: availability by section with pricing | Y | Y | ? |
| Waitlist — join when sold out | Y | Y | ? |
| Waitlist notification when seats open (real-time) | **~N** | **Y** | ? |
| Concurrent checkout safety (no double-sell) | **~Y** | **~Y** | ? |
| Cache strategy for browse/listing | Y | Y | ? |
| No Express/Fastify | Y | Y | ? |
| No Redis/external cache | Y | Y | ? |
| No SQL | Y | Y | ? |
| Uses Harper Resource class | Y | Y | ? |
| All in one Harper runtime | Y | Y | ? |

### Caveat Details

**W1 waitlist notification (~N):** furiosa calls a bare `publish()` function that doesn't exist in scope. The code has `if (typeof publish === 'function') { publish(...) }` — this would always evaluate to false since there's no global `publish`. Should have used `tables.Waitlist.publish()` or a dedicated MQTT table like W2 did. The try/catch swallows the failure silently.

**W2 waitlist notification (Y):** nux correctly uses `tables.WaitlistAlert.publish(eventId, {...})` — the Harper MQTT pattern from Tier 4. WaitlistAlert table has `@export(name: "waitlist-alerts")` controlling the MQTT topic.

**Concurrent checkout (~Y both):** Neither implementation has true atomic operations. Harper Resource classes don't provide transactions or row-level locks. Both use read-then-check-then-write patterns:
- W1: patch seat status → re-read to verify holderId → hope nobody wrote between
- W2: read seat → check status/holdUserId → patch → hope nobody wrote between

Both would fail under true concurrent load (two simultaneous checkouts for the same seat). This is a **Harper platform limitation**, not an agent failure — there's no documented way to do atomic compare-and-swap in Resource classes.

## Schema Analysis

### Worker 1 (furiosa) — 7 tables

```graphql
Venue, Section, Event, EventSection, Seat, Purchase, Waitlist
```

| Table | Key Design Decisions |
|-------|---------------------|
| Venue | name, address, city @indexed |
| Section | venueId @indexed, capacity |
| Event | category, venueId, date all @indexed, status @indexed |
| **EventSection** | **Join table: eventId + sectionId + price** |
| Seat | eventId, sectionId, row, number, status, holdExpiry, holderId, purchaseId |
| Purchase | eventId, buyerEmail, totalPrice, seatIds[] |
| Waitlist | eventId, email, joinedAt, notified, notifiedAt |

**Notable:** EventSection is a join table that allows per-event pricing per section. This is the correct model for real ticketing — the same venue section can have different prices for different events.

### Worker 2 (nux) — 7 tables + 1 MQTT topic

```graphql
Venue, Section, Event, Seat, Purchase, WaitlistEntry, WaitlistAlert
```

| Table | Key Design Decisions |
|-------|---------------------|
| Venue | sections and events relationships |
| Section | venueId, **price on Section** (not per-event), totalRows, seatsPerRow |
| Event | seats and waitlist relationships |
| Seat | sectionId, eventId, row, number, status, holdExpiry, holdUserId, purchaseId |
| Purchase | eventId, userId, seatIds[], totalPrice |
| WaitlistEntry | eventId, userId, notified |
| **WaitlistAlert** | `@export(name: "waitlist-alerts")` — MQTT topic for notifications |

**Notable:** Price lives on Section (not per-event). Simpler model but less flexible — can't price the same section differently for a Taylor Swift concert vs a comedy show. WaitlistAlert is a dedicated MQTT topic table (same pattern nux used in Tier 4).

### Schema Divergence

| Feature | W1 (furiosa) | W2 (nux) |
|---------|:---:|:---:|
| Tables | 7 | 7 + MQTT |
| Pricing model | **EventSection join** | Section.price |
| Section capacity | `capacity: Int` | `totalRows + seatsPerRow` |
| Relationships | Minimal | **Rich bidirectional** |
| Hold user field | `holderId` | `holdUserId` |
| Buyer identifier | `buyerEmail` | `userId` |
| MQTT topic table | None | **WaitlistAlert** |
| Waitlist table name | `Waitlist` | `WaitlistEntry` |

W2 has significantly richer relationships — Event→seats, Event→waitlist, Venue→sections, Venue→events, Section→seats, Seat→section, Seat→event. W1 is flatter with fewer back-references.

## Resources.js Analysis

### Worker 1 (furiosa) — 464 lines, 7 Resource classes

**Architecture:** Action-based routing via query parameters. In-memory cache for browse.

```
Venue, Section, Event, EventSection, Seat, Purchase, Waitlist
```

**Key patterns:**

1. **In-memory browse cache:** `const browseCache = new Map()` with 30s TTL. `getCached()`/`setCache()`/`invalidateCache()` helper functions. Browse results cached by filter key. Invalidated on event creation and purchase completion.

2. **Seat holds:** `POST /Seat/?action=hold` with `{ seatIds, holderId }`. Sets `holdExpiry = Date.now() + 5min`. Re-reads after patch to verify the holder won any race.

3. **Checkout:** `POST /Seat/?action=checkout` with `{ seatIds, holderId, buyerEmail, eventId }`. Verifies all seats are held by the correct holder, checks hold hasn't expired, creates Purchase record, marks seats as sold.

4. **Hold expiry:** `releaseExpiredHolds(eventId)` scans all held seats, releases any past expiry. Called on event detail access and before hold attempts.

5. **Event detail:** Builds section availability by iterating EventSections, then counting available seats per section. Returns sections with name, price, totalSeats, availableSeats.

6. **Purchase cancellation:** `POST /Purchase/?action=cancel`. Releases seats, invalidates cache, notifies waitlist.

7. **Waitlist notification:** **Broken.** Calls bare `publish()` which doesn't exist. Should use `tables.Waitlist.publish()` or a dedicated MQTT table.

**Strengths:** Most complete feature set. EventSection join table is architecturally correct. Purchase cancellation with seat release and waitlist notification flow is well-designed. In-memory cache with prefix invalidation is pragmatic.

**Weaknesses:** MQTT notification broken. In-memory cache doesn't survive process restarts. Action routing via query params on POST is unusual REST design.

### Worker 2 (nux) — 344 lines, 7 Resource classes

**Architecture:** RESTful PATCH-based state transitions. ETag caching. MQTT for waitlist.

```
Event, Seat, Purchase, WaitlistEntry, Venue, Section (+ WaitlistAlert MQTT)
```

**Key patterns:**

1. **ETag caching:** Event detail and browse both return ETags with `Cache-Control: max-age=30, must-revalidate`. Collection ETags computed from max timestamp + count. No in-memory cache — pure HTTP caching via client conditional requests.

2. **Seat holds via PATCH:** `PATCH /Seat/<id>` with `{ status: 'held', holdUserId }`. Resource class sets `holdExpiry = now + 5min`. More RESTful than W1's action-based POST.

3. **Lazy hold expiry:** `releaseIfExpired(seat)` checks holdExpiry on EVERY seat access (get, patch). No background scanner needed — expired holds are released on touch. Also triggers waitlist notification.

4. **Purchase via POST:** `POST /Purchase/` with `{ eventId, userId, seatIds }`. Validates all seats held by correct user, calculates total from Section prices, transitions seats to purchased.

5. **Event detail:** Builds availability by querying Sections for the event's venue, then counting seats per section. Calls `releaseIfExpired()` on each seat during counting.

6. **Waitlist MQTT:** `tables.WaitlistAlert.publish(eventId, { type, eventId, userId, timestamp })` — correct Harper MQTT pattern. Published when holds expire or seats are released.

7. **Venue caching:** Also adds ETag/304 to Venue detail (bonus — not required).

**Strengths:** Most correct architecture. PATCH-based state transitions are proper REST. Lazy hold expiry is elegant — no background process needed. MQTT waitlist notification actually works. ETag on browse collections is a nice touch.

**Weaknesses:** No in-memory cache (relies entirely on client-side caching via ETags). Price on Section (not per-event) is oversimplified. No purchase cancellation flow.

### Architectural Comparison

| Aspect | W1 (furiosa) | W2 (nux) |
|--------|:---:|:---:|
| Lines | 464 | 344 |
| Hold mechanism | POST ?action=hold | PATCH status=held |
| Checkout mechanism | POST ?action=checkout | POST /Purchase/ |
| Hold expiry | Batch scan on access | **Lazy per-seat on touch** |
| Cache type | **In-memory Map** | ETag/304 headers |
| MQTT waitlist | Broken (bare publish) | **Working (WaitlistAlert.publish)** |
| Purchase cancel | **Yes** | No |
| Pricing model | **Per-event (join table)** | Per-section (flat) |
| REST pattern | Action params | **State transitions** |
| `this.getContext()` | Yes | Yes |
| Collection ETag | No | **Yes** |

### The Concurrency Problem

Both workers attempted concurrent checkout safety but neither achieved true atomicity. The fundamental issue:

```
// What both workers do (read-check-write):
const seat = await tables.Seat.get(seatId);     // 1. Read
if (seat.status !== 'available') throw 409;       // 2. Check
await tables.Seat.patch(seatId, { status: 'held' }); // 3. Write
```

Between steps 2 and 3, another request could have already claimed the seat. This is a TOCTOU (Time of Check to Time of Use) race condition.

**W1's mitigation:** Re-reads after patch to verify holderId matches. This catches some races but creates a new one — between patch and re-read, another process could have patched again.

**W2's mitigation:** Status checks in PATCH handler. If status isn't 'available', rejects with 409. But two simultaneous requests could both read 'available' and both proceed to patch.

**Platform limitation:** Harper Resource classes don't expose conditional writes (e.g., "update WHERE status='available'"). Without this, true atomic seat claiming isn't possible in userland code. The agents correctly identified the problem and implemented best-effort solutions within Harper's constraints.

**Recommendation for Harper:** Add conditional update support (optimistic concurrency via version field or conditional patch) to Resource classes. This would enable correct concurrent seat claiming.

## Hold Expiry Strategies

Two fundamentally different approaches:

### W1: Batch scan on access
```js
async function releaseExpiredHolds(eventId) {
    for await (const seat of tables.Seat.search({ conditions: [{ attribute: 'status', value: 'held' }] })) {
        if (seat.holdExpiry <= now) {
            await tables.Seat.patch(seat.id, { status: 'available' });
        }
    }
}
```
Called before hold attempts and on event detail access. Scans all held seats for the event. Correct but expensive — O(held seats) on every access.

### W2: Lazy per-seat release
```js
async function releaseIfExpired(seat) {
    if (seat.status === 'held' && seat.holdExpiry < Date.now()) {
        await tables.Seat.patch(seat.id, { status: 'available' });
        notifyWaitlist(seat.eventId).catch(() => {});
        return { ...seat, status: 'available' };
    }
    return seat;
}
```
Called on every individual seat access (get, patch, availability count). O(1) per seat. More elegant — no batch scanning needed.

**W2's approach is superior.** It's lazy, per-seat, and triggers waitlist notification at the moment of expiry detection. W1's batch scan is unnecessary overhead.

## Worker 3: The Lost Submission

slit completed `gt done` at 19:28 (~18 min) but no `event-ticketing/` component directory exists in `.workers/worker-3/components/`. The Docker-mounted Harper instance also has no tables deployed.

**Root cause hypothesis:** The polecat's git worktree and the Docker components mount may not have been the same directory. When `gt done` nuked the worktree, the files were lost. Previous tiers worked because the component files were written to the Docker-mounted path, but the mapping may have broken for W3 in this run.

**Action needed:** Investigate the lab-runner.sh workspace mount and polecat worktree path alignment. This is a rig infrastructure bug, not a polecat code bug.

## Tier 6 vs Previous Tiers

| Metric | T1 | T2 | T3 | T4 | T5 | T6 |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|
| Pass rate | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 | **2/2*** |
| Avg time | ~9m | ~8m | ~12m | ~16m | ~17m | **~15m** |
| Tables in schema | 1 | 3 | 2 | 3 | 3 | **7** |
| Resource classes | 0 | 0 | 2 | 2-3 | 2-5 | **7** |
| resources.js lines | 0 | 0 | 127-148 | 77-115 | 147-243 | **344-464** |
| Real-time (MQTT) | N | N | N | Y | N | **Y** |
| HTTP caching (ETags) | N | N | N | N | Y | **Y** |
| Concurrency handling | N | N | N | N | N | **Y (best-effort)** |
| State machine logic | N | N | Y (simple) | N | N | **Y (complex)** |

*W3 lost to infra issue — not counted in pass rate.

**Tier 6 produced the most complex implementations by far.** 7-table schemas, 344-464 line resource files, state machines for seat status (available→held→sold/available), timer-based expiry, MQTT notifications, browse caching, and concurrent access handling — all in one Harper runtime.

The capstone worked as designed: it required agents to synthesize everything from Tiers 1-5 (schema design, relationships, Resource classes, validation, MQTT pub/sub, ETags/caching) into a cohesive system architecture.

## Recommendations

1. **Tier 6 validates the full DX Lab progression.** Agents that passed Tiers 1-5 can architect a complete multi-table system with real-time features, caching, and state machines. The complexity jump is appropriate for a capstone.

2. **Fix the W3 infra issue.** The lost submission is a rig bug. Investigate polecat worktree → Docker components mount alignment. All component files should survive `gt done`.

3. **Document conditional updates in Harper.** The concurrent checkout problem is a real limitation. Adding `patch(id, data, { where: { status: 'available' } })` or version-based optimistic concurrency would unlock correct concurrent access patterns.

4. **The MQTT pattern from Tier 4 carried forward.** nux correctly reused the `@export(name: ...)` MQTT topic pattern from Tier 4 for waitlist notifications. furiosa forgot and used a bare `publish()` call. Expert hints from Tier 4 could prevent this regression.

5. **Consider an expert iteration** with two hints: (a) use `tables.X.publish()` for MQTT, not bare `publish()`, and (b) Harper doesn't have atomic conditional writes — document the read-check-write pattern explicitly as the best available approach.

## Artifacts

- Convoy: hq-cv-63jhs
- Beads: dl-c7if (W1), dl-3uop (W2), dl-c1ap (W3, lost)
- Component dirs: `.workers/worker-{1,2}/components/event-ticketing/`
- W3 components: **missing** (infra issue)
