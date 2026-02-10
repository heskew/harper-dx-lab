# Tier 4 Cohort Review: 2026-02-09

## Run Parameters

| Parameter | Value |
|-----------|-------|
| Tier | 4 — Real-Time MQTT & WebSocket |
| Assignment | tier-4-notification-hub.md |
| Harper Image | harperdb:v5-local |
| Expert Iteration | 0 (no expert hints) |
| Workers | 3 |
| Convoy | hq-cv-pl2gg |

## Result: 3/3 PASS

All 3 workers independently completed the Tier 4 assignment with working Resource classes, MQTT alert publishing, WebSocket `connect()` generators, and `subscribe()` overrides. Zero expert interventions. The `gt done` instruction added to sling args (from Tier 3 post-mortem) successfully prevented the idle-at-prompt problem — no nudges required.

## Workers

| Worker | Polecat | Bead | Time | Result |
|--------|---------|------|------|--------|
| 1 | furiosa | dl-8kr3 | ~14 min | PASS |
| 2 | nux | dl-zj7j | ~23 min | PASS |
| 3 | slit | dl-bp7m | ~12 min | PASS |

## Timeline

- 17:08 — Docker stacks created (Tier 3 torn down first), MQTT ports exposed (11885, 11887, 11889)
- 17:10 — Beads created, polecats spawned, convoy hq-cv-pl2gg tracking all 3
- 17:22 — slit (W3) completes `gt done` (~12 min)
- 17:24 — furiosa (W1) completes `gt done` (~14 min)
- 17:33 — nux (W2) completes `gt done` (~23 min)
- 17:33 — Convoy 3/3 COMPLETE

## Pass Criteria

| Criterion | W1 | W2 | W3 |
|-----------|:--:|:--:|:--:|
| Schema: Channel and Notification tables | Y | Y | Y |
| Schema: Alert/Alerts table for MQTT topics | Y | Y | Y |
| `@relationship` links Channel→Notifications | Y | Y | Y |
| `channelId` indexed with `@indexed` | Y | Y | Y |
| Can CRUD channels | Y | Y | Y |
| Can CRUD notifications | Y | Y | Y |
| Can filter by severity | Y | Y | Y |
| Can filter by read/unread status | Y | Y | Y |
| `read` defaults to `false` on creation | Y | Y | Y |
| Validates title, body, severity, channelId | Y | Y | Y |
| Validates channel exists (404) | Y | Y | Y |
| `subscribe()` method implemented | Y | Y | Y |
| `connect()` method implemented | Y | Y | Y |
| Critical notifications publish to Alert MQTT topic | Y | Y | Y |
| Alert payload includes channelName | Y | Y | Y |
| Uses Harper Resource class — no Express/Fastify | Y | Y | Y |
| No external message broker | Y | Y | Y |
| No SQL | Y | Y | Y |

## Schema Analysis

### Worker 1 (furiosa)
```graphql
type Channel @table {
  id: ID @primaryKey
  name: String
  description: String
  notifications: [Notification] @relationship(to: channelId)
  createdAt: Float @createdTime
}

type Alerts @table {
  id: ID @primaryKey
}

type Notification @table {
  id: ID @primaryKey
  title: String
  body: String
  severity: String
  channelId: ID @indexed
  channel: Channel @relationship(from: channelId)
  read: Boolean
  createdAt: Float @createdTime
}
```

### Worker 2 (nux)
```graphql
type Channel @table @export {
  id: ID @primaryKey
  name: String @indexed
  description: String
  createdAt: Float @createdTime
  notifications: [Notification] @relationship(to: channelId)
}

type Notification @table @export {
  id: ID @primaryKey
  title: String
  body: String
  severity: String @indexed
  channelId: ID @indexed
  channel: Channel @relationship(from: channelId)
  read: Boolean
  createdAt: Float @createdTime
}

type Alert @table @export(name: "alerts") {
  id: ID @primaryKey
}
```

### Worker 3 (slit)
```graphql
type Channel @table @export {
  id: ID @primaryKey
  name: String
  description: String
  notifications: [Notification] @relationship(to: channelId)
  createdAt: Any @createdTime
}

type Notification @table {
  id: ID @primaryKey
  title: String
  body: String
  severity: String
  channelId: ID @indexed
  channel: Channel @relationship(from: channelId)
  read: Boolean
  createdAt: Any @createdTime
}

type Alert @table @export {
  id: ID @primaryKey
  title: String
  body: String
  severity: String
  channelId: ID
  channelName: String @indexed
  createdAt: Any @createdTime
}
```

### Schema Divergence

| Feature | W1 (furiosa) | W2 (nux) | W3 (slit) |
|---------|:---:|:---:|:---:|
| `@export` on tables | **No** | **Yes** | **Partial** |
| `@indexed` on severity | N | **Y** | N |
| `@indexed` on name | N | **Y** | N |
| Timestamp type | Float | Float | Any |
| Alert table name | `Alerts` (plural) | `Alert` + `@export(name: "alerts")` | `Alert` |
| Alert table fields | Minimal (id only) | Minimal (id only) | **Full fields** |
| Bidirectional relationship | Y | Y | Y |

**Notable divergences:**

1. **Alert table naming:** W1 named it `Alerts` (plural), W2 named it `Alert` with `@export(name: "alerts")` to control the MQTT topic prefix, W3 named it `Alert` with `@export`. The MQTT topic path depends on the export name — W2's approach is the most deliberate.

2. **Alert table schema:** W3 stored full alert data (title, body, severity, channelId, channelName) in the Alert table, treating it as both a record store and MQTT topic. W1 and W2 kept it minimal (id only), using it purely as an MQTT publish target. Both approaches are valid; W3's is more durable if alert history needs querying.

3. **`@export` usage:** W1 used no `@export` at all (relying on Resource class exports), W2 exported everything including a custom name for alerts, W3 mixed. This is the first tier where `@export` strategy truly matters since it controls MQTT topic names.

4. **Timestamp type:** W3 used `Any` for createdAt, which is unconventional. `Float` (W1, W2) is the standard Harper pattern for `@createdTime`.

## Resources.js Analysis — The Core of Tier 4

### Architecture Comparison

All 3 workers correctly:
- Extended `tables.Notification` for the main Resource class
- Set `static loadAsInstance = false`
- Validated all required fields in `post()` with proper 400/404 status codes
- Looked up the channel by ID before posting
- Defaulted `read` to `false` when not specified
- Called `super.post()` to persist the notification
- Published to notification subscribers after save
- Published to the Alert table's MQTT topic for critical severity
- Implemented `subscribe()` and `connect()` methods

### Worker 1 (furiosa) — Most Complete Architecture

**Pattern:** Three exported classes (`Alerts`, `Channel`, `Notification`). Helper functions for error creation.

```js
export class Alerts extends tables.Alerts { }
export class Channel extends tables.Channel { ... }
export class Notification extends tables.Notification { ... }
```

- **Publish pattern:** `Notification.publish(target, data, this)` for general subscribers, `Alerts.publish(channel.name, {...}, this)` for critical alerts
- **subscribe():** `super.subscribe({ ...subscription, includeDescendants: true })` — adds `includeDescendants` for broader subscription scope
- **connect():** `super.connect()` — simplest form, delegates entirely to Harper
- **Channel validation:** Yes, exported `Channel` class with name validation in `post()`
- **Lines:** 77
- **Extra:** Exported `Alerts` as a stub class (needed so Harper exposes it as an MQTT topic)

**Strengths:** Most architecturally correct. The `Alerts` stub export ensures Harper creates the MQTT topic. `includeDescendants: true` on subscribe is a savvy touch — ensures clients subscribed to the collection receive individual record updates. `super.connect()` is the simplest correct form.

### Worker 2 (nux) — Richest Test Coverage

**Pattern:** Two exported classes (`Channel`, `Notification`). Inline validation. Uses `this.publish()` instance method.

```js
export class Channel extends tables.Channel { ... }
export class Notification extends tables.Notification { ... }
```

- **Publish pattern:** `this.publish(target, data)` for general subscribers, `tables.Alert.publish(channel.name, {...}, this)` for critical alerts via the tables reference
- **subscribe():** `return super.subscribe(subscriptionRequest)` — simple passthrough
- **connect():** `async *connect(incomingMessages)` — generator that subscribes and yields messages from `tables.Notification.subscribe()`
- **Channel validation:** Yes, validates name present and non-empty string
- **Lines:** 90 (resources.js)
- **Extra:** 274-line comprehensive test script (`test-realtime.mjs`) testing CRUD, MQTT critical alerts on `alerts/infra` topic, and WebSocket real-time delivery

**Strengths:** Most thorough test coverage. The test script is production-grade with pass/fail assertions, timeout handling, and three distinct test phases (CRUD, MQTT, WebSocket). The `async *connect()` generator pattern with `for await...of` is a clean real-time streaming approach.

**Note:** Uses `tables.Alert.publish()` (via the tables reference) rather than exporting an Alert Resource class. This works because `@export(name: "alerts")` in the schema makes the table available for MQTT publishing without a Resource class export.

### Worker 3 (slit) — Deepest Feature Set

**Pattern:** One exported class (`Notification` only, no Channel class). Factory error functions. Custom `get()` override for filtering.

```js
export class Notification extends tables.Notification { ... }
```

- **Publish pattern:** `Notification.publish(result, data, this)` — publishes to the new record's ID topic, `tables.Alert.publish(channelName, alertMessage, this)` for critical alerts
- **subscribe():** `return super.subscribe(subscriptionRequest)` — simple passthrough
- **connect():** `async *connect(incomingMessages)` — generator identical to W2 (subscribes + yields)
- **Custom get():** Overrides `get()` to support query parameter filtering via `target.get('severity')`, `target.get('read')`, `target.get('channelId')` with `tables.Notification.search({ conditions })`
- **Channel validation:** No (no Channel Resource class exported)
- **Lines:** 115
- **Extra:** 192-line test script subscribing to both `Notification/#` and `Alert/#` topics

**Strengths:** Only worker to implement custom query parameter filtering in `get()`. The `target.get()` / `target.isCollection` pattern shows deep understanding of Harper's request target API. Also the only worker that publishes to the new record's ID (`Notification.publish(result, data, this)`) rather than the generic target.

**Weakness:** No Channel Resource class — channel CRUD works via the default table behavior, but there's no name validation on channel creation.

### Key Pattern: Real-Time Publish

The core real-time pattern across all 3 workers:

```js
async post(target, data) {
  const result = await super.post(target, data);          // 1. Persist
  Notification.publish(target, data, this);                // 2. Notify subscribers
  if (data.severity === 'critical') {
    AlertTable.publish(channel.name, alertPayload, this);  // 3. MQTT alert
  }
  return result;
}
```

All 3 independently arrived at this same 3-step pattern. The publish calls happen after the successful save, which is the correct order (don't notify until persisted).

**Variation in publish target:**
- W1: `Notification.publish(target, data, this)` — publishes to the request target
- W2: `this.publish(target, data)` — instance method call
- W3: `Notification.publish(result, data, this)` — publishes to the new record ID

W1 and W2's approach broadcasts to collection subscribers. W3's approach is more specific — it publishes to the individual record's topic. With W1's `includeDescendants: true` on subscribe, collection subscribers would receive both.

### Key Pattern: connect() Generator

Workers 2 and 3 both used the async generator pattern:

```js
async *connect(incomingMessages) {
  const subscription = await tables.Notification.subscribe();
  for await (const message of subscription) {
    yield message;
  }
}
```

Worker 1 used the simpler delegation: `super.connect()`.

Both approaches are correct for Harper WebSocket connections. The generator pattern gives more control (could filter messages, transform payloads, etc.) while `super.connect()` is the minimal correct form.

### Key Pattern: Alert MQTT Topic

| Aspect | W1 (furiosa) | W2 (nux) | W3 (slit) |
|--------|:---:|:---:|:---:|
| Alert class exported | **Yes** (stub) | No | No |
| Alert table `@export` | No | `@export(name: "alerts")` | `@export` |
| Publish call | `Alerts.publish(...)` | `tables.Alert.publish(...)` | `tables.Alert.publish(...)` |
| Topic would be | `Alerts/{channelName}` | `alerts/{channelName}` | `Alert/{channelName}` |

The MQTT topic names differ due to `@export` naming:
- W1: `Alerts/infra` (class name, plural)
- W2: `alerts/infra` (custom export name, lowercase)
- W3: `Alert/infra` (table name, singular)

This is a real divergence that would matter for MQTT subscribers. W2's approach with `@export(name: "alerts")` is the most explicit about controlling the topic prefix. The test scripts each match their own topic conventions.

## Test Scripts

All 3 workers wrote real-time test scripts (`test-realtime.mjs`), which is notable — this is the first tier where agents proactively wrote integration tests.

| Feature | W1 (furiosa) | W2 (nux) | W3 (slit) |
|---------|:---:|:---:|:---:|
| Lines | 233 | 274 | 192 |
| Installed `mqtt` npm package | Y | N | Y |
| CRUD tests | Y | Y | Y |
| MQTT notification subscribe | Y | Y | Y |
| MQTT critical alert test | Y | Y | Y |
| WebSocket test | Y | Y | N |
| Pass/fail counters | N | Y | Y |
| Proper timeout handling | Y | Y | Y |

**W2 (nux)** wrote the most comprehensive test — 3 distinct phases (CRUD, MQTT, WebSocket) with 20+ assertions, proper MQTT v5 protocol, and clean teardown. It subscribes to `alerts/{channelName}` to verify the exact topic path.

**W1 (furiosa)** also tested all 3 channels (CRUD, MQTT, WebSocket) and installed the `mqtt` npm package, though without pass/fail counters.

**W3 (slit)** covered MQTT but not WebSocket, using broader wildcard subscriptions (`Notification/#`, `Alert/#`) to catch all traffic.

## config.yaml

All 3 workers produced identical `config.yaml`:

```yaml
graphqlSchema:
  files: 'schema.graphql'

jsResource:
  files: 'resources.js'

rest: true
```

This is a **100% config.yaml production rate** — up from 2/3 in Tier 3 and 0/3 in Tier 2. By Tier 4, all agents understand that custom resources need explicit config.

**Notable absence:** None of the workers added MQTT-specific configuration to `config.yaml`. Harper's MQTT broker is enabled at the server level (via Docker env vars), not at the component level. All 3 agents correctly didn't try to configure MQTT in the component config.

## Operations Notes: gt done Fix Validated

### Tier 3 problem
All 3 polecats completed implementation but idled at the prompt for ~60 minutes, requiring manual mayor nudge.

### Tier 4 fix applied
Added to sling args: "When implementation is complete and all criteria verified, immediately run `gt done` to submit and exit. Do not wait at the prompt."

### Result
**Fix successful.** All 3 polecats exited cleanly:
- slit: ~12 min total
- furiosa: ~14 min total
- nux: ~23 min total

No polecats got stuck. No nudges required. The explicit instruction in sling args is sufficient to prevent the idle-at-prompt problem.

### Recommendation
Make this instruction permanent in the sling arg template. It should be part of every polecat dispatch.

## Tier 4 vs Previous Tiers

| Metric | T1 (Run 2) | T2 | T3 | T4 |
|--------|:-:|:-:|:-:|:-:|
| Pass rate | 3/3 | 3/3 | 3/3 | **3/3** |
| Avg implementation time | ~9 min | ~8 min | ~12 min | **~16 min** |
| Files produced | 1 | 1 | 2-4 | **3-5** |
| Custom JS required | No | No | Yes | **Yes** |
| Resource class exports | No | No | Yes | **Yes** |
| Real-time (pub/sub) | No | No | No | **Yes** |
| MQTT integration | No | No | No | **Yes** |
| WebSocket connect() | No | No | No | **Yes** |
| Test scripts written | 0/3 | 0/3 | 0/3 | **3/3** |
| config.yaml produced | 1/3 | 0/3 | 2/3 | **3/3** |
| Expert interventions | 0 | 0 | 0 | **0** |
| Nudges required | 0 | 0 | 3 | **0** |

Implementation time increased ~33% vs Tier 3, reflecting the added complexity of real-time pub/sub, MQTT alert publishing, and WebSocket generators. All agents proactively wrote integration test scripts for the first time — the real-time nature of the assignment made testing feel more necessary.

## Doc Gaps Identified

1. **MQTT topic naming via `@export`.** The three workers produced three different topic prefixes (`Alerts/`, `alerts/`, `Alert/`) because the relationship between `@export(name: ...)` and MQTT topic paths is not clearly documented. This would cause integration failures if different components need to agree on topic names.

2. **`publish()` method signature.** Workers called it three different ways:
   - `ClassName.publish(target, data, this)` (static with target)
   - `this.publish(target, data)` (instance)
   - `ClassName.publish(id, data, this)` (static with record ID)

   The docs should clarify the canonical signature and what the first argument controls (topic path).

3. **`connect()` method pattern.** Two patterns emerged — `super.connect()` (delegation) and `async *connect()` with manual subscribe+yield. Both work, but the docs should recommend one and explain when to use each.

4. **`subscribe()` with `includeDescendants`.** Only W1 used this option. It's not clear from docs when this is needed or what the default subscription scope covers.

5. **`target.get()` for query parameters.** Only W3 discovered `target.get('severity')` and `target.isCollection` for extracting query params in a Resource class `get()`. This is a powerful API that's hard to find in the docs.

## Recommendations

1. **Tier 4 is graduated.** 3/3 passes, all criteria met. Agents correctly used Harper's built-in MQTT pub/sub without trying to install external brokers (RabbitMQ, Redis pub/sub, etc.). The Resource class real-time pattern works.

2. **Lock in the `gt done` sling arg fix.** This is now validated across one full cohort with zero stuck polecats. Make it permanent.

3. **Document MQTT topic naming.** The `@export(name: ...)` → MQTT topic relationship needs an explicit example in the docs. Show that `@export(name: "alerts")` means the MQTT topic prefix is `alerts/`.

4. **Document `publish()` canonical usage.** Show the recommended call pattern: `ClassName.publish(topicSuffix, payload, context)`.

5. **Consider a Tier 5.** Tiers 1-4 are all 100% pass rate. Possible Tier 5 targets: authentication/authorization, file uploads, or multi-component communication.

## Artifacts

- Convoy: hq-cv-pl2gg
- Beads: dl-8kr3 (W1), dl-zj7j (W2), dl-bp7m (W3)
- Component dirs: `.workers/worker-{1,2,3}/components/notification-hub/`
- Docker MQTT ports: 11885 (W1), 11887 (W2), 11889 (W3)
