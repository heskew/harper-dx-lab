# Tier 3 Cohort Review: 2026-02-09

## Run Parameters

| Parameter | Value |
|-----------|-------|
| Tier | 3 — Custom Resources & Business Logic |
| Assignment | tier-3-task-tracker.md |
| Harper Image | harperdb:v5-local |
| Expert Iteration | 0 (no expert hints) |
| Workers | 3 |
| Convoy | hq-cv-3bmpm |

## Result: 3/3 PASS

All 3 workers independently completed the Tier 3 assignment with working Resource classes, validation, stats endpoint, and completion rules. Zero expert interventions on the implementation. Mayor nudge required to unstick the `gt done` commit flow (see Operations Notes).

## Workers

| Worker | Polecat | Bead | Implementation Time | Wall Time (incl. stuck) | Result |
|--------|---------|------|---------------------|-------------------------|--------|
| 1 | furiosa | dl-t45n | ~8 min | ~81 min | PASS |
| 2 | nux | dl-u8b2 | ~15 min | ~81 min | PASS |
| 3 | slit | dl-mveu | ~13 min | ~81 min | PASS |

**Note:** Wall time includes ~60 minutes of idle time where polecats were stuck at the prompt after completing implementation but before running `gt done`. Actual implementation times are the meaningful metric.

## Timeline

- 15:21 — Docker stacks created (Tier 2 torn down first)
- 15:22 — Beads created, polecats spawned, convoy hq-cv-3bmpm tracking all 3
- 15:30 — furiosa (W1) finishes implementation (~8 min)
- 15:35 — slit (W3) finishes implementation (~13 min)
- 15:37 — nux (W2) finishes implementation (~15 min)
- 15:37–16:41 — All 3 idle at prompt (stuck on commit flow)
- 16:41 — Mayor nudges all 3 polecats
- 16:42 — nux completes `gt done`
- 16:43 — slit and furiosa complete `gt done`

## Pass Criteria

| Criterion | W1 | W2 | W3 |
|-----------|:--:|:--:|:--:|
| Schema deployed with Project and Task tables | Y | Y | Y |
| `@relationship` correctly links Project→Tasks | Y | Y | Y |
| FK `projectId` indexed with `@indexed` | Y | Y | Y |
| Can CRUD projects | Y | Y | Y |
| Can CRUD tasks | Y | Y | Y |
| Can retrieve project with nested tasks | Y | Y | Y |
| Can filter tasks by status | Y | Y | Y |
| Can filter tasks by priority | Y | Y | Y |
| Task creation validates title, status, priority | Y | Y | Y |
| Task creation validates project exists | Y | Y | Y |
| Task creation rejects archived project (400) | Y | Y | Y |
| `updatedAt` auto-set on create/update | Y | Y | Y |
| `GET /Project/:id/stats` returns correct counts | Y | Y | Y |
| Cannot complete project with incomplete tasks (400) | Y | Y | Y |
| Uses Harper Resource class — no Express/Fastify | Y | Y | Y |
| No SQL | Y | Y | Y |

## Schema Analysis

### Worker 1 (furiosa)
```graphql
type Project @table {
  id: ID @primaryKey
  name: String
  description: String
  status: String
  createdAt: Long @createdTime
  tasks: [Task] @relationship(to: projectId)
}

type Task @table {
  id: ID @primaryKey
  title: String
  description: String
  status: String
  priority: String
  projectId: ID @indexed
  project: Project @relationship(from: projectId)
  createdAt: Long @createdTime
  updatedAt: Long @updatedTime
}
```

### Worker 2 (nux)
```graphql
type Project @table {
  id: ID @primaryKey
  name: String
  description: String
  status: String
  createdAt: Date @createdTime
  tasks: [Task] @relationship(to: projectId)
}

type Task @table {
  id: ID @primaryKey
  title: String
  description: String
  status: String @indexed
  priority: String @indexed
  projectId: ID @indexed
  project: Project @relationship(from: projectId)
  createdAt: Date @createdTime
  updatedAt: Date @updatedTime
}
```

### Worker 3 (slit)
```graphql
type Project @table {
  id: ID @primaryKey
  name: String
  description: String
  status: String
  tasks: [Task] @relationship(to: projectId)
  createdAt: Long @createdTime
}

type Task @table {
  id: ID @primaryKey
  title: String
  description: String
  status: String
  priority: String
  projectId: ID @indexed
  project: Project @relationship(from: projectId)
  createdAt: Long @createdTime
  updatedAt: Long @updatedTime
}
```

### Schema Divergence

| Feature | W1 (furiosa) | W2 (nux) | W3 (slit) |
|---------|:---:|:---:|:---:|
| `@table` (no `@export`) | Y | Y | Y |
| `@relationship(to:)` on Project.tasks | Y | Y | Y |
| `@relationship(from:)` on Task.project | Y | Y | Y |
| `@indexed` on projectId | Y | Y | Y |
| `@indexed` on status/priority | N | **Y** | N |
| Timestamp type | Long | Date | Long |
| `@createdTime` / `@updatedTime` | Y | Y | Y |

**Notable:** No worker used `@export` on the types — they all relied on the Resource class exports instead. This is correct for Tier 3 since custom resources override the default REST behavior.

Worker 2 (nux) added `@indexed` on `status` and `priority` fields, anticipating filter queries. The others relied on unindexed filtering, which works but is less efficient.

## Resources.js Analysis — The Core of Tier 3

### Architecture Comparison

All 3 workers correctly:
- Extended `tables.Project` and `tables.Task` (Harper's Resource class pattern)
- Set `static loadAsInstance = false` (correct for table-backed resources)
- Used `tables.Task.search()` with conditions for querying related tasks
- Threw errors with `statusCode` property for HTTP error codes
- Implemented both `put()` and `patch()` overrides on Project for completion checks

### Worker 1 (furiosa) — Cleanest Implementation

**Pattern:** Minimal, focused. Two classes, each overriding only what's needed.

```js
export class Project extends tables.Project { ... }
export class Task extends tables.Task { ... }
```

- Stats endpoint: Intercepts `get()` by checking if `id` ends with `/stats`
- Validation: Inline in `post()` method
- Completion check: Shared `checkAllTasksDone()` helper
- Error pattern: Manual `new Error()` + `statusCode`
- Lines: 127

**Strengths:** Direct, readable, minimal abstraction.

### Worker 2 (nux) — Most Abstracted

**Pattern:** Extracted shared `validateTaskData()` function and `throwBadRequest()` helper. Also validates project statuses.

```js
const { Project: ProjectTable, Task: TaskTable } = tables;
function throwBadRequest(message) { ... }
async function validateTaskData(data, isCreation = true) { ... }
export class Task extends TaskTable { ... }
export class Project extends ProjectTable { ... }
```

- Stats endpoint: Most defensive — checks `target.pathname`, then `target.toString()`, then regex fallback, then `target.id` fallback
- Validation: Centralized `validateTaskData()` with `isCreation` flag differentiating create vs update
- Also validates `PROJECT_STATUSES` on put
- `completionPercentage`: Rounds to 2 decimal places
- Lines: 148

**Strengths:** Most defensive coding, best separation of concerns.
**Weakness:** Stats endpoint path parsing is over-engineered with 4 fallback strategies.

### Worker 3 (slit) — Best Error Handling

**Pattern:** Factory functions for error creation, extracted `getIncompleteTasks()` helper.

```js
function badRequest(message) { ... }  // Returns error (doesn't throw)
function notFound(message) { ... }
async function getIncompleteTasks(projectId) { ... }
export class Project extends tables.Project { ... }
export class Task extends tables.Task { ... }
```

- Stats endpoint: Uses `target.pathname` with `.split('/').filter(Boolean)` to extract ID
- Error pattern: Factory functions that return errors, caller throws — cleaner separation
- Completion check: Returns structured objects with id, title, and status for error messages
- Lines: 137

**Strengths:** Cleanest error handling pattern, best error messages (includes task status in completion errors).
**Also produced:** `config.yaml` with explicit `jsResource` and `rest` settings, and `package.json` with `"type": "module"`.

### Key Pattern: Stats Endpoint via GET Override

All 3 workers used the same approach for `GET /Project/:id/stats`:

```js
async get(target) {
  if (/* path ends with /stats */) {
    return this.getStats(extractedId);
  }
  return super.get(target);
}
```

This is the correct Harper pattern — intercept the `get()` method and route internally. No worker tried to create a separate Express route or a standalone endpoint class. **The Resource class docs are working for this pattern.**

However, the path parsing varied significantly:
- W1: `target.id.endsWith('/stats')` → simple string check
- W2: 4 fallback strategies (pathname, toString, regex, id strip)
- W3: `target.pathname.endsWith('/stats')` + split

**Finding:** The docs don't clearly specify what properties are available on the `target` parameter (pathname? id? toString?). All 3 workers used different access patterns, suggesting this is under-documented.

### Key Pattern: tables.Task.search() for Cross-Table Queries

All 3 workers used the same core pattern for querying tasks:
```js
for await (const task of tables.Task.search({
  conditions: [{ attribute: 'projectId', value: projectId }]
})) { ... }
```

This is correct — `tables.Task.search()` with conditions is the Harper way to query within a Resource class. No worker tried SQL, `.query()`, or manual filtering.

**Finding:** The `search()` API with conditions is well-documented enough for agents to discover independently.

### Validation Patterns

| Validation | W1 | W2 | W3 |
|------------|:--:|:--:|:--:|
| Title present + non-empty | Y | Y | Y |
| Status in enum | Y | Y | Y |
| Priority in enum | Y | Y | Y |
| projectId required | Y | Y | Y |
| Project exists | Y | Y | Y |
| Project not archived | Y | Y | Y |
| Validates on `post()` | Y | Y | Y |
| Validates on `put()` | N | Y | N |
| Validates on `patch()` | N | Y | N |

Worker 2 (nux) was the only one to add validation on `put` and `patch` for tasks, not just `post`. The assignment only required creation validation, so all 3 pass, but nux went further.

## config.yaml and Extra Files

| File | W1 | W2 | W3 |
|------|:--:|:--:|:--:|
| schema.graphql | Y | Y | Y |
| resources.js | Y | Y | Y |
| config.yaml | N | Y | Y |
| package.json | N | N | Y |

Workers 2 and 3 produced `config.yaml` with explicit `jsResource: files: 'resources.js'` — this is important for Tier 3 since the custom resources need to be loaded. Worker 1 relied on auto-discovery.

Worker 3 also produced `package.json` with `"type": "module"` to ensure ESM imports work correctly.

**Finding:** The `jsResource` config entry may be required for Harper to load custom resources. The fact that W1 worked without it (in dev mode) but W2/W3 included it suggests dev mode auto-discovers JS files, but production would need explicit config.

## Operations Notes: The Stuck Commit Problem

### What happened

All 3 polecats completed their implementation work (8-15 min) but then went idle at the Claude Code prompt for ~60 minutes. They had finished the `implement` step of `mol-polecat-work` but did not progress through the remaining molecule steps (self-review → tests → cleanup → submit → `gt done`).

### Root cause

The polecats output their results and stopped. They didn't autonomously run `bd close <step>` to advance through the molecule, nor did they run `gt done` to self-clean. The session was waiting for user input.

### Fix applied

Mayor nudged all 3 with: "run `bd ready` to find remaining steps, close them, then run `gt done`". All 3 completed within 2 minutes of the nudge.

### Prevention recommendations

1. **Add to sling args:** Append "When implementation is complete and all criteria verified, immediately run `gt done` to submit and exit. Do not wait." to the `--args` string.

2. **Strengthen mol-polecat-work implement step exit criteria:** Add explicit instruction: "When done, immediately close this step with `bd close <step-id>` and proceed to self-review. Do NOT wait at the prompt."

3. **Witness timeout:** The Witness should detect polecats idle for >10 minutes and nudge them automatically. Currently only the Mayor noticed.

## Tier 3 vs Previous Tiers

| Metric | Tier 1 (Run 2) | Tier 2 | Tier 3 |
|--------|:-:|:-:|:-:|
| Pass rate | 3/3 (100%) | 3/3 (100%) | 3/3 (100%) |
| Avg implementation time | ~9.0 min | ~8.3 min | ~12.0 min |
| Files produced | 1 (schema) | 1 (schema) | 2-4 (schema + resources + config) |
| Custom JS required | No | No | **Yes** |
| Resource class used | No | No | **Yes** |
| Validation logic | No | No | **Yes** |
| Cross-table queries | No | No | **Yes** |
| config.yaml produced | 1/3 | 0/3 | 2/3 |
| Expert interventions | 0 | 0 | 0 |

Implementation time increased ~40% vs Tier 2, which is modest given the significant jump in complexity (schema-only → schema + custom JavaScript with business logic).

## Recommendations

1. **Tier 3 is graduated.** 3/3 passes, all criteria met, agents correctly discovered and used Harper's Resource class pattern without hallucinating Express/Fastify.

2. **Doc gap: `target` parameter properties.** All 3 workers used different strategies to parse the request target in `get()`. Document what properties (`id`, `pathname`, `toString()`) are available on the target parameter.

3. **Doc gap: `jsResource` in config.yaml.** Clarify whether custom resources require explicit `jsResource` config or are auto-discovered. 1/3 workers worked without it (dev mode), but production behavior is unclear.

4. **Fix polecat commit flow.** Add explicit `gt done` instruction to sling args and strengthen the molecule's exit criteria to prevent idle-at-prompt stalls. Consider Witness auto-nudge for >10 min idle.

5. **Proceed to Tier 4** (Real-Time MQTT & WebSocket). Tiers 1-3 are solid — agents can model data, use relationships, and write custom Resource classes.

## Artifacts

- Convoy: hq-cv-3bmpm
- Beads: dl-t45n (W1), dl-u8b2 (W2), dl-mveu (W3)
- Branches: `polecat/furiosa/dl-t45n@mlfspl0a`, `polecat/nux/dl-u8b2@mlfsq4xk`, `polecat/slit/dl-mveu@mlfsqo8p`
- Component dirs: `.workers/worker-{1,2,3}/components/task-tracker/`
