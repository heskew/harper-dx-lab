## Project Type Management

The DX Lab isn't limited to the six predefined tiers. You need to be able to
define new project types, run custom assignments, and manage a catalog of
experiments.

### Project Types

```yaml
# assignments/catalog.yaml
project_types:
  # ─── Standard Tiers (the core curriculum) ───
  - id: tier-1-crud
    name: "Tier 1: Basic CRUD"
    tier: 1
    assignment_file: tier-1-bookmark-manager.md
    features_tested: [schema, rest, indexed]
    estimated_duration: 30m
    pass_criteria_file: tier-1-pass.sh

  - id: tier-2-relationships
    name: "Tier 2: Relationships & Joins"
    tier: 2
    assignment_file: tier-2-recipe-app.md
    features_tested: [relationships, nested_select, joins]
    estimated_duration: 45m
    pass_criteria_file: tier-2-pass.sh
    requires_graduated: [tier-1-crud]

  # ─── Custom / One-Off Experiments ───
  - id: custom-auth-patterns
    name: "Custom: Authentication Patterns"
    tier: 3  # approximate complexity
    assignment_file: custom-auth-app.md
    features_tested: [resources, jwt, middleware]
    estimated_duration: 60m
    pass_criteria_file: custom-auth-pass.sh
    tags: [security, custom, requested-by-harper-team]

  # ─── Showcase App Builds (Tier 6 variants) ───
  - id: showcase-flowsense
    name: "Showcase: FlowSense Supply Chain"
    tier: 6
    assignment_file: flowsense-assignment.md
    features_tested: [all]
    estimated_duration: 180m
    pass_criteria_file: flowsense-pass.sh
    requires_graduated: [tier-1-crud, tier-2-relationships, tier-3-resources, tier-4-realtime]

  - id: showcase-pulse
    name: "Showcase: Pulse Monitoring"
    tier: 6
    assignment_file: pulse-assignment.md
    features_tested: [mqtt, resources, relationships, caching]
    estimated_duration: 120m

  # ─── Regression Tests (re-run graduated tiers with new Harper versions) ───
  - id: regression-v5.1
    name: "Regression: v5.1 Compatibility"
    tier: 0  # all tiers
    assignment_file: regression-all-tiers.md
    harper_version: "5.1.0"
    tags: [regression, release-gate]
```

### Running Custom Experiments

```bash
# Run a standard tier
./lab-runner.sh --project tier-2-relationships --agents 3

# Run a custom experiment
./lab-runner.sh --project custom-auth-patterns --agents 2

# Run a showcase build
./lab-runner.sh --project showcase-flowsense --agents 1

# Run regression against a new Harper version
./lab-runner.sh --project regression-v5.1 --agents 3 --harper-image harperdb/harperdb:5.1.0

# Run without expert (baseline measurement)
./lab-runner.sh --project tier-1-crud --agents 3 --no-expert

# Run with expert at a specific iteration
./lab-runner.sh --project tier-2-relationships --agents 3 --expert-iteration 2
```

### Project Lifecycle

```
DRAFT → QUEUED → RUNNING → COMPLETED → HUMAN_REVIEW → GRADUATED
                    ↑                        │
                    └── NEEDS_RERUN ◄────────┘ (if review finds issues)
```

New project types can be added by anyone — the Harper team, community members,
or the Lab Director itself based on patterns it observes. A project type is
just an assignment markdown file + a pass criteria script + a catalog entry.

## Complexity Tiers

Each tier tests a specific layer of Harper knowledge. An agent must pass a tier
using ONLY the docs before the tier is considered "graduated." Multiple agents
run the same tier in parallel for statistical confidence.

### Tier 1 — Basic CRUD
**Tests**: Can someone create a table, insert data, and query it?
**Assignment**: "Build a bookmark manager. Users can save URLs with tags and search them."
**Harper features tested**:
- `schema.graphql` with `@table`, `@primaryKey`, `@export`
- `@indexed` on searchable fields
- REST API: POST to create, GET to query, PUT to update, DELETE to remove
- URL query parameters: filtering, select(), limit()

**Pass criteria**:
- Schema deploys without errors
- CRUD operations work via curl
- Agent used `@indexed` on fields it queries (not just `@primaryKey`)
- Agent did NOT invent SQL queries, `.query()` methods, or other non-Harper patterns
- Time to first working endpoint < 15 minutes

**What failures at this tier reveal**:
- Getting started guide is missing steps
- Schema syntax docs are unclear
- REST query parameter docs are incomplete
- Agent hallucinated SQL or MongoDB-style queries

---

### Tier 2 — Relationships & Joins
**Tests**: Can someone model relational data and query across tables?
**Assignment**: "Build a recipe app. Recipes have ingredients (from an Ingredients table) and belong to categories. Query recipes by ingredient name."
**Harper features tested**:
- `@relationship(from: fk)` — many-to-one
- `@relationship(to: fk)` — one-to-many
- Nested `select()` in REST queries: `?select(name,ingredients(name,amount),category(name))`
- Chained attribute search across relationships

**Pass criteria**:
- Relationships resolve in REST responses (not just raw FK IDs)
- Agent can query recipes filtered by ingredient name (join query)
- Agent uses `@relationship` correctly (not manual lookups in JS)
- Schema has proper FK fields with `@indexed`

**What failures at this tier reveal**:
- Relationship docs need more examples
- `select()` with nested relationships is poorly documented
- Agents don't discover that `@indexed` is required on FK fields
- Join query syntax isn't obvious from REST docs

---

### Tier 3 — Custom Resources & Business Logic
**Tests**: Can someone extend a table with custom JavaScript endpoints?
**Assignment**: "Build a task manager with auto-assignment. When a task is created, it should automatically assign to the team member with the lowest workload. Expose a `/Dashboard/` endpoint that returns team stats."
**Harper features tested**:
- `resources/` JavaScript modules
- Extending table classes (e.g., `class Task extends tables.Task`)
- `get()`, `post()`, `put()`, `patch()`, `delete()` method overrides
- Accessing other tables via `tables.TeamMember` within a resource
- `@export` vs exporting from resources.js (and not doing both)
- Transactions across tables

**Pass criteria**:
- Custom POST creates task AND assigns it (single request)
- Dashboard endpoint aggregates real data from multiple tables
- Agent understood Resource class inheritance, not Express-style routing
- Agent did NOT create a separate Express/Fastify server

**What failures at this tier reveal**:
- Resource class docs need more examples of multi-table operations
- `tables.X` global access pattern isn't well explained
- Agents confused by GraphQL schema vs JavaScript — which does what?
- Transaction docs need practical examples

---

### Tier 4 — Real-Time (MQTT & WebSocket)
**Tests**: Can someone build a real-time feature using Harper's built-in MQTT?
**Assignment**: "Build a live chat app. Messages are stored in Harper. When a new message is posted, all connected clients receive it instantly via WebSocket. Include typing indicators via MQTT."
**Harper features tested**:
- MQTT broker (built-in, no separate service)
- Publishing from custom resources
- `connect(incomingMessages)` for WebSocket/SSE on resources
- MQTT topic design
- Client-side MQTT-over-WebSocket connection

**Pass criteria**:
- Messages persist in Harper AND broadcast in real-time
- No external message broker used (no Redis, no Kafka, no separate Mosquitto)
- Agent discovered Harper's built-in MQTT from the docs
- WebSocket/SSE connection works from browser

**What failures at this tier reveal**:
- Real-time docs are the most likely to be incomplete
- MQTT configuration in harperdb-config.yaml needs examples
- `connect()` API isn't well documented
- Agents assume they need a separate WebSocket server

---

### Tier 5 — Vector Search & AI Integration
**Tests**: Can someone use Harper's HNSW vector indexing for semantic search?
**Assignment**: "Build a knowledge base. Users upload text documents. Generate embeddings and store them. Provide semantic search that finds similar documents."
**Harper features tested**:
- `@indexed(type: "HNSW", distance: "cosine")` on embedding fields
- `Resource.search()` with `sort: { attribute, target }` for nearest-neighbor
- Computed properties (`@computed`) for derived fields
- Integration with external embedding APIs from custom resources

**Pass criteria**:
- Vector index created correctly in schema
- Nearest-neighbor search returns ranked results
- Agent used `search()` with `sort` parameter (not manual distance calc)
- Embeddings stored as `[Float]` array type

**What failures at this tier reveal**:
- Vector indexing docs are sparse
- `search()` API with sort for nearest-neighbor isn't intuitive
- HNSW parameters (efConstruction, M) need guidance
- Computed property + indexing interaction needs examples

---

### Tier 6 — Full Application (Integration Test)
**Tests**: Can someone build a complete, non-trivial app that uses multiple Harper capabilities together?
**Assignment**: Varies — could be FlowSense, could be a different app. The point is it requires Tiers 1-5 working together.
**Harper features tested**: All of them in combination.

**Pass criteria**: App works end-to-end, no mock data, no external services that Harper replaces.

**What failures at this tier reveal**: Integration gaps between features that are individually documented but poorly connected.

---

## The Lab Protocol

### Running a Tier

```
1. SELECT tier and assignment
2. LAUNCH isolated workers:
   ./lab-runner.sh --tier 1 --agents 3
   This spins up N independent Docker stacks, each with:
   - Its own Harper instance (own ports, own data volume)
   - Its own empty workspace mounted into Harper's component directory
   - The assignment file mounted read-only
   - No shared state between workers whatsoever
3. CONNECT a Claude Code session to each worker:
   - Each agent gets ONLY:
     a. The assignment description
     b. The URL to Harper docs (https://docs.harperdb.io/docs)
     c. Its worker's Harper URLs (HARPER_APP_URL, MQTT_URL)
   - Each agent does NOT get:
     a. Any Harper-specific tips or hints
     b. Previous agent results
     c. CLAUDE.md or skill files (those are the OUTPUT, not input)
4. OBSERVE each agent's process:
   - What docs pages did they fetch?
   - What did they try that failed?
   - What APIs did they hallucinate?
   - What patterns did they use from other databases?
   - Where did they get stuck longest?
   - What questions did they ask that the docs didn't answer?
5. RECORD results per agent:
   - Time to first working code
   - Number of doc page fetches
   - Hallucinated API calls (list each one)
   - Stuck points (what, how long, what unblocked them)
   - Final pass/fail on tier criteria
6. ANALYZE across all agents:
   - Common hallucinations → doc gap or misleading wording
   - Common stuck points → missing example or unclear explanation
   - Divergent approaches → docs don't recommend a canonical path
   - Fast completions → docs are working for this area
7. TEAR DOWN workers, COLLECT observations:
   ./lab-runner.sh --cleanup
8. PRODUCE improvements (see Outputs below)
9. RE-RUN tier with improvements applied (new workers, fresh state)
10. MEASURE delta (time, hallucinations, pass rate)
11. GRADUATE tier when pass rate ≥ 80% across agents
```

### Parallel Execution Model

This is designed to run like a research lab, not a sequential pipeline.
Multiple tiers can run simultaneously with different agent cohorts.

```
Week 1: (6 Docker workers total on Mac Studio — well within budget)
  Cohort A (3 workers): Tier 1 — CRUD (baseline)
  Cohort B (3 workers): Tier 1 — CRUD (same assignment, parallel for variance)

  ./lab-runner.sh --tier 1 --agents 3 --cohort a
  ./lab-runner.sh --tier 1 --agents 3 --cohort b

Week 1 analysis → produce doc patches for Tier 1 gaps

Week 2: (8 workers — scouting ahead while fixing behind)
  Cohort C (3 workers): Tier 1 — CRUD (re-run with improved docs, verify fix)
  Cohort D (3 workers): Tier 2 — Relationships (start next tier)
  Cohort E (2 workers): Tier 3 — Resources (scout ahead for big gaps)

Week 2 analysis → Tier 1 graduated, produce Tier 2 patches, identify Tier 3 blockers

Week 3:
  Cohort F (3 workers): Tier 2 — Relationships (re-run with patches)
  Cohort G (3 workers): Tier 3 — Resources
  Cohort H (2 workers): Tier 4 — Real-time (scout)

...and so on.
```

Each "cohort" is a set of isolated Docker workers, each running one Claude Code
session against its own Harper instance. The lead (you) reviews results, identifies
patterns, and produces improvements. Workers from different cohorts never interact.

---

