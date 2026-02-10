# Harper DX Lab

Automated developer experience testing for [Harper](https://github.com/harperfast/harper) using AI agents.

## What This Is

The DX Lab runs AI coding agents (Claude Code via [Gas Town](https://github.com/steveyegge/gastown)) against Harper's documentation and APIs to measure developer experience. Each agent receives an assignment of increasing complexity and must build a working application using only Harper — no human assistance, no hand-holding.

When an agent fails, the failure is diagnosed and classified. When agents succeed but diverge in approach, the divergence reveals documentation gaps and API design friction. The result is a prioritized list of DX improvements backed by reproducible evidence.

## How It Works

```
Assignment → AI Agent → Harper Instance → Review
                ↓                            ↓
          Finds docs              Pass/Fail + Divergence
          Makes decisions         Analysis + Findings
          Writes code
          Tests it
```

**Tiers** increase in complexity from basic CRUD to full-stack real-time applications. Each tier runs as a **cohort** of 3 independent agents working in parallel on identical assignments with isolated Harper instances.

**Expert iterations** test documentation fixes. When a tier produces failures, targeted hints are added to an expert knowledge base and the tier is re-run. The delta between iteration 0 (no hints) and iteration 1 (with hints) quantifies the value of the documentation improvement.

## Tier Progression

| Tier | Focus | Complexity | Status |
|------|-------|------------|--------|
| 1 | CRUD & Schema | Basic tables, REST queries, FIQL search | ✅ Graduated (7/7) |
| 2 | Relationships | @relationship directives, nested queries | ✅ Graduated (3/3) |
| 3 | Custom Resources | Resource classes, validation, computed endpoints | ✅ Graduated (3/3) |
| 4 | Real-Time | MQTT pub/sub, WebSocket, subscribe/publish | ✅ Graduated (3/3) |
| 5 | Caching & Performance | ETags, conditional requests, cache invalidation | ✅ Graduated (2/3 → 3/3 with hint) |
| 6 | Capstone: Event Ticketing | Full system architecture, concurrency, state machines | ✅ Complete (2/2*) |
| 6b | Multi-Tenant SaaS | Tenant isolation, RBAC, scoped real-time | 📋 Designed |
| 6c | IoT Sensor Platform | MQTT ingest, time-series, threshold alerting | 📋 Designed |

*1 worker lost to infrastructure bug

## Findings

Findings reports are generated per run day in `findings/`. Each finding is classified by type and severity, with hit rates and actionable recommendations.

## Repository Structure

```
├── assignments/              # Tier assignment documents
│   ├── tier-1-bookmark-manager.md
│   ├── tier-2-recipe-book.md
│   ├── tier-3-task-tracker.md
│   ├── tier-4-notification-hub.md
│   ├── tier-5-product-catalog.md
│   ├── tier-6-event-ticketing.md
│   ├── tier-6b-multi-tenant-saas.md
│   └── tier-6c-iot-sensor-platform.md
├── docker/
│   ├── docker-compose.worker.yml   # Per-worker Harper + workspace stack
│   ├── lab-runner.sh               # Spawns isolated worker environments
│   └── lab-teardown.sh             # Archives artifacts and tears down
├── expert-knowledge/
│   ├── iteration-0/               # No hints (baseline)
│   ├── iteration-1/               # getContext() hint
│   ├── iteration-2/               # + MQTT pattern, concurrency warning
│   └── current -> iteration-2     # Active iteration symlink
├── findings/                       # Aggregated findings reports
├── reviews/                        # Per-cohort review documents
└── .workers/                       # Per-worker component directories (gitignored)
```

## Running a Cohort

### Prerequisites

- [Gas Town](https://github.com/steveyegge/gastown) installed and configured
- Docker (Docker Desktop or Colima)
- Harper v5 Docker image built locally as `harperdb:v5-local`

### Build the Harper Image

```bash
git clone https://github.com/harperfast/harper.git ~/src/harper
cd ~/src/harper && npm install && npm run build
docker build -t harperdb:v5-local .
```

### Run a Single Worker

```bash
./docker/lab-runner.sh --tier 1 --harper-image harperdb:v5-local --worker-id 1
```

### Run a Cohort via Gas Town

Attach to the Mayor and instruct it to run a cohort:

```bash
gt mayor attach
```

```
Run a 3-worker Tier 1 cohort against harperdb:v5-local.

For each worker (1, 2, 3):
1. Run: ./docker/lab-runner.sh --tier 1 --harper-image harperdb:v5-local --worker-id <N> --expert-iteration 0
2. Sling the assignment to a polecat
3. In the sling args, include: "Verify ALL pass criteria before running 'gt done'."
4. Track all 3 as a convoy

After all 3 complete, generate a review at reviews/tier1-cohort-<date>.md.
```

## Expert Iteration Loop

1. Run tier at iteration 0 (no hints) → observe failures
2. Diagnose root cause from review
3. Write targeted hints in `expert-knowledge/iteration-N/pitfalls.md`
4. Update symlink: `ln -sf iteration-N expert-knowledge/current`
5. Re-run tier at iteration N → measure improvement
6. Repeat until pass rate is acceptable

## Finding Classifications

| Type | Meaning | Example |
|------|---------|---------|
| `platform_limitation` | Can't be solved in userland | No atomic conditional writes |
| `dx_gap` | Missing feature or unclear default | config.yaml rest:true |
| `doc_gap` | Feature exists but docs don't surface it | this.getContext() |
| `doc_bug` | Broken links or incorrect info | 404s on /docs/developers/* |
| `api_behavior` | Unexpected behavior vs conventions | PATCH replaces vs merges |
| `api_design` | API surface friction | target param inconsistency |
| `infra_bug` | Lab infrastructure issue | Worktree/mount misalignment |

