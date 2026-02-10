# DX Lab Findings Report — 2026-02-09

## Overview

The Harper DX Lab runs AI agents (Claude Code) against Harper documentation
to measure developer experience. Agents receive assignments of increasing
complexity with no human assistance. Failures indicate documentation gaps
or platform limitations.

**Date:** February 9, 2026
**Harper Version:** v5 (open-source, built from harperfast/harper)
**Total Runs:** 6 tiers, 21 worker sessions, 18 passes, 1 fail, 1 lost, 1 iteration re-run
**Model:** Claude Opus 4.6 via Claude Code (Pro subscription)

---

## Findings by Severity

### CRITICAL: No atomic conditional writes (Platform Limitation)

**Tier:** 6 (Event Ticketing Capstone)
**Hit Rate:** 2/2 reviewable workers
**Classification:** platform_limitation

Neither worker could implement safe concurrent seat checkout. Both used
read-check-write patterns that are vulnerable to TOCTOU race conditions:

```js
const seat = await tables.Seat.get(seatId);
if (seat.status === 'available') {
  await tables.Seat.put({ ...seat, status: 'held' }); // RACE
}
```

Harper Resource classes do not support:
- Transactions
- Row-level locks
- Compare-and-swap / optimistic locking with version checks
- Conditional writes (write-if-unchanged)

**Impact:** Any application requiring concurrent write safety (ticketing,
inventory, auctions, banking) cannot guarantee correctness on Harper today.
This is a platform limitation, not a documentation issue.

**Recommendation:** Consider adding conditional write support, e.g.:
`tables.X.put(record, { ifVersion: previousVersion })` that rejects
writes if the record has changed since it was read.

---

### HIGH: `this.getContext()` not discoverable (Doc Gap)

**Tier:** 5 (Product Catalog with Caching)
**Hit Rate:** 1/3 workers failed to discover it (iteration 0)
**Classification:** doc_gap
**Status:** CONFIRMED FIXED with expert hint (iteration 1: 3/3 PASS, 35% faster)

Accessing HTTP request/response headers from within a Resource class
requires `this.getContext()`. One worker (furiosa) built a complete
product catalog in 10 minutes but completely skipped ETags/caching
because it couldn't discover how to access HTTP headers.

The other two workers found it but took 21 minutes (vs 12 minutes with
the expert hint in iteration 1).

**Evidence:**
- Iteration 0: 2/3 PASS (67%), avg 17 min
- Iteration 1 (with 30-line hint): 3/3 PASS (100%), avg 11 min (-35%)

**Recommendation:** Add a prominent example in Resource class docs:
```js
async get(target) {
  const context = this.getContext();
  const ifNoneMatch = context.headers.get('if-none-match');
  // ... ETag logic
  return { status: 304, headers: { 'ETag': etag } };
}
```

---

### HIGH: `target` parameter properties undocumented (Doc Gap)

**Tier:** 3 (Task Tracker)
**Hit Rate:** 3/3 workers used different strategies
**Classification:** doc_gap

Three workers, three different approaches to parse the request path in
a Resource `get()` method:

- W1: `target.id.endsWith('/stats')`
- W2: 4 fallback strategies (pathname, toString, regex, id strip)
- W3: `target.pathname.endsWith('/stats')` + split

Documentation doesn't specify what properties (`id`, `pathname`,
`toString`, `get()`, `has()`, `delete()`) are available on the `target`
parameter passed to Resource methods.

**Recommendation:** Document the `target` object's API — it appears to
behave like a URLSearchParams-like object with additional properties.

---

### MEDIUM: config.yaml `rest: true` not obvious (DX Gap)

**Tier:** 1 (Bookmark Manager)
**Hit Rate:** 9/10 workers (across pilot + 2 cohorts)
**Classification:** dx_gap

Nearly every worker missed that `rest: true` is required in config.yaml
to enable the REST API. The default should arguably be `true` for new
components, or the error message when REST is disabled should explicitly
say "add rest: true to config.yaml".

---

### MEDIUM: FIQL `=ct=` operator not discoverable (Doc Gap)

**Tier:** 1 (Bookmark Manager)
**Hit Rate:** 6/6 workers (across 2 cohorts)
**Classification:** doc_gap

No worker discovered the `=ct=` (contains) operator for substring
search via FIQL query parameters. All used `conditions` in `search()`
instead. The FIQL operators are documented but not prominent enough
for discovery.

---

### MEDIUM: MQTT `tables.X.publish()` pattern inconsistent (Doc Gap)

**Tier:** 4 → 6 (Real-Time → Capstone)
**Hit Rate:** 1/2 workers in Tier 6 used wrong pattern
**Classification:** doc_gap

In Tier 4 (Notification Hub), all 3 workers discovered
`tables.X.publish()` correctly. In Tier 6, one worker (furiosa) used
a bare `publish()` call that doesn't exist. Knowledge doesn't persist
across tiers — each agent starts fresh.

**Also in Tier 4:** MQTT topic naming diverged (`Alerts/`, `alerts/`,
`Alert/`) due to unclear `@export(name: ...)` → topic path mapping.

---

### MEDIUM: MQTT topic naming from `@export` unclear (Doc Gap)

**Tier:** 4 (Notification Hub)
**Hit Rate:** 3/3 workers chose different topic naming
**Classification:** doc_gap

Workers couldn't determine canonical MQTT topic names from schema
exports. Produced `Alerts/`, `alerts/`, and `Alert/` for the same
logical channel.

---

### LOW: Doc 404s (Doc Bug)

**Tier:** 1
**Hit Rate:** 6/6 workers
**Classification:** doc_bug

Broken documentation links:
- `/docs/developers/rest-queries` → 404
- `/docs/developers/components` → 404

---

### LOW: PATCH replaces vs merges (API Behavior)

**Tier:** 1
**Hit Rate:** 1/6 workers noted this
**Classification:** api_behavior

Harper's PATCH operation replaces the entire record rather than merging
only the provided fields. This differs from standard REST PATCH semantics
(RFC 7396 JSON Merge Patch).

---

### INFRA: Polecat worktree / Docker mount misalignment (Rig Bug)

**Tier:** 6
**Hit Rate:** 1/3 workers (slit)
**Classification:** infra_bug

Worker 3 completed its implementation (~18 min) and ran `gt done`, but
files were never found in the Docker-mounted component directory. The
polecat likely wrote to its git worktree instead of the Docker-mounted
`.workers/worker-3/components/` path. When `gt done` nuked the worktree,
the files were lost.

**Fix:** Ensure sling args include the explicit component path, and add
an archive step before teardown to preserve artifacts.

---

## Progression Summary

| Tier | Focus | Pass Rate | Avg Time | Key Finding |
|------|-------|-----------|----------|-------------|
| 1 | CRUD | 7/7 (100%) | ~9 min | config.yaml rest:true, FIQL discoverability |
| 2 | Relationships | 3/3 (100%) | ~8 min | @relationship docs excellent |
| 3 | Custom Resources | 3/3 (100%) | ~12 min | target param undocumented |
| 4 | Real-Time | 3/3 (100%) | ~16 min | MQTT topic naming ambiguity |
| 5 | Caching/ETags | 2/3 (67%) | ~17 min | this.getContext() not discoverable |
| 5.1 | (with hint) | 3/3 (100%) | ~11 min | Expert hint: +33% pass, -35% time |
| 6 | Capstone | 2/2* (100%) | ~13 min | Concurrent checkout unsolvable, MQTT pattern regression |

*1 worker lost to infrastructure bug, not counted

### Tier 6 Detail: Capstone Complexity

Both reviewable workers built complete event ticketing systems in ~13 min:
7-table schemas, 344-464 lines of business logic, seat hold state machines
(available→held→sold), timer-based expiry, MQTT waitlist notifications,
browse caching — all in one Harper runtime with zero guidance.

Notable architectural divergence:
- **Pricing model:** W1 used an EventSection join table (correct for real
  ticketing — different pricing per event). W2 put price on Section (simpler
  but inflexible).
- **Hold expiry:** W1 batch-scans all held seats on access (O(n)). W2 uses
  lazy per-seat release on touch (O(1)) — the superior pattern.
- **MQTT:** W2 correctly used `tables.WaitlistAlert.publish()`. W1 used bare
  `publish()` which silently fails — regression from Tier 4 where W1 got it right.

## Methodology

Each tier runs 3 independent AI agents (Claude Code via Gas Town) against
the same assignment with fresh Harper instances. Agents have full web
access to search documentation. No human intervention during runs.

Expert iterations inject targeted hints (pitfalls docs) and re-run to
measure improvement, quantifying the value of documentation additions.

## What's Next

- Tier 6b: Multi-tenant SaaS (tenant isolation, RBAC)
- Tier 6c: IoT Sensor Platform (MQTT ingest, time-series, alerting)
- Expert iteration on Tier 6 findings
- Distributed clustering tiers (pending multi-node support)
