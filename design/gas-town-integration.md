# DX Lab on Gas Town + Beads

The previous design invented custom orchestration (Lab Director) and a custom
data layer (Harper-based Experiment Ledger). Both are unnecessary. Gas Town
already solves multi-agent coordination and Beads already solves persistent
state tracking. The DX Lab should be a **specific Gas Town configuration**
with **specialized Beads types** — not a ground-up system.

---

## Why Not a Running Harper Service?

The "dogfooding" argument for a Harper-backed Ledger sounded good but was
working against us:

| Harper-based Ledger | Beads |
|---|---|
| Requires a running service | File-based. No daemon. |
| Separate infrastructure to manage | Just files in git. |
| Need backup strategy | Git IS the backup. |
| Workers need network access to Ledger | Workers write local files. Git syncs later. |
| Custom ingestion pipeline | Agents use `bd` directly — already agent-native. |
| Custom query API (REST) | `bd list`, `bd show`, SQLite queries. |
| Single point of failure | Distributed by design. |
| Schema changes require migration | JSONL is append-only, schema-flexible. |

Beads was literally designed for this problem: structured work tracking
across multiple agents, backed by git, with full audit trail. The DX Lab's
observations, issues, and outputs are just beads with custom types.

The actual dogfooding opportunity is richer: Harper is what the agents BUILD
AGAINST inside the workers. The lab tests Harper's DX by using it for real.
We don't need to also use it as the lab's plumbing — that just creates a
dependency on the thing we're testing.

---

## What Gas Town Already Provides

```
Gas Town Concept       → DX Lab Equivalent
─────────────────────────────────────────────────
Mayor                  → Lab Director (orchestrates experiments)
Rig                    → The DX Lab project itself
Polecats               → Fresh SWE workers (ephemeral, spawn → work → disappear)
Hooks                  → Expert knowledge persistence (survives sessions)
Convoys                → Cohorts (a batch of experiments tracked together)
gt sling               → Dispatching tier assignments to workers
Witness                → Stuck detection (already monitors worker health)
Formulas               → Tier protocols (repeatable, parameterized workflows)
Beads                  → ALL state: observations, issues, patches, skills, tiers
Dashboard              → Lab visibility (convoy progress, agent status)
Mail                   → Inter-agent communication (Expert ↔ SWE if needed)
```

Almost everything the DX Lab needs is a configuration of something Gas Town
already does. The unique parts are the PROTOCOLS and ROLES, not the machinery.

---

## What the DX Lab Adds

Gas Town is a general multi-agent workspace manager. The DX Lab is a specific
application with unique requirements that Gas Town doesn't have opinions about:

### 1. The Silent Observer Protocol
Gas Town agents collaborate freely. The DX Lab's Expert MUST be a silent
observer with strict intervention rules (stuck hints, completion reviews).
This is a role constraint, implemented via the Expert's system prompt and
the formula that defines the experiment workflow.

### 2. Docker Isolation Per Worker
Gas Town uses git worktrees for workspace isolation. The DX Lab needs
stronger isolation — each worker gets a fresh Harper instance in Docker.
The SWE builds against this isolated Harper. This is an infrastructure
layer that wraps Gas Town's polecat lifecycle.

### 3. Issue Classification (Triage)
Standard beads have types like "bug" and "feature." The DX Lab adds a
research-specific classification: doc_gap, actual_bug, dx_bug, api_design,
feature_gap, security. This is a custom Beads type extension.

### 4. Tier Graduation
No Gas Town equivalent. Tiers are a DX Lab concept — graduated tiers
become regression tests. This is state tracked in Beads with a custom
TierStatus type.

### 5. Expert Bootstrap Loop
The Expert improves over iterations. Expert knowledge (skills, pitfalls,
memory) is versioned and accumulates. This maps naturally to Gas Town's
Hooks (persistent state per agent) but has a specific iteration protocol.

### 6. Observation Framework
Detailed capture of SWE behavior (wrong turns, self-corrections, doc
fetches, hallucinations) is DX Lab-specific. This is the research data
that makes the lab valuable. Implemented as Beads custom types.

---

## Architecture: DX Lab as a Gas Town Rig

```
~/gt/                               # Gas Town workspace
├── dx-lab/                         # The DX Lab rig
│   ├── .beads/
│   │   ├── beads.jsonl             # ALL lab state lives here
│   │   ├── formulas/
│   │   │   ├── tier-1-run.formula.toml
│   │   │   ├── tier-2-run.formula.toml
│   │   │   ├── cohort.formula.toml
│   │   │   └── regression.formula.toml
│   │   └── config.yaml
│   ├── .claude/
│   │   └── settings.json           # Lab-specific Claude Code config
│   ├── CLAUDE.md                   # Lab Director instructions
│   ├── AGENTS.md                   # DX Lab-specific agent roles
│   ├── expert-knowledge/
│   │   ├── current -> iteration-3/ # Symlink to latest
│   │   ├── iteration-0/
│   │   ├── iteration-1/
│   │   ├── iteration-2/
│   │   └── iteration-3/
│   │       ├── skills/
│   │       ├── pitfalls.md
│   │       └── memory.md
│   ├── assignments/
│   │   ├── tier-1-bookmark-manager.md
│   │   ├── tier-2-recipe-relationships.md
│   │   └── ...
│   ├── docker/
│   │   ├── docker-compose.worker.yml   # Template for worker stacks
│   │   └── lab-runner.sh               # Spawns Docker + slings work
│   └── reviews/                        # Human review packages
│       ├── cohort-2026-02-08.md
│       └── ...
```

### The Mayor Runs the Lab

No custom Lab Director needed. The Gas Town Mayor, configured with DX Lab
instructions in CLAUDE.md, handles:

```bash
# You tell the Mayor what to do
gt mayor attach

> "Run a Tier 1 cohort with 3 workers against Harper alpha.5"

# Mayor:
# 1. Creates beads for each experiment
# 2. Creates a convoy tracking the cohort
# 3. Spins up Docker stacks (via lab-runner.sh)
# 4. Slings tier assignments to polecats
# 5. Monitors progress via convoy
# 6. Collects observations when workers complete
# 7. Generates review package
# 8. Notifies you: "Cohort complete, awaiting review"
```

### Polecats Are the Workers

Each worker is a Gas Town polecat with a Docker-isolated environment:

```bash
# lab-runner.sh wraps polecat spawning with Docker setup
gt sling tier-1-exp-001 dx-lab  # Slings the experiment bead to a polecat
                                 # lab-runner.sh intercepts: spins up Docker,
                                 # injects assignment, configures expert
```

The polecat runs two agents internally (Fresh SWE + Expert observer).
When done, it writes observations as beads and disappears.

### Convoys Are Cohorts

```bash
# A cohort is just a convoy with metadata
gt convoy create "Tier 1 — alpha.5 — iter 3" exp-001 exp-002 exp-003 --notify

# Track it
gt convoy list
# OUTPUT:
# dx-cv-a1b2  "Tier 1 — alpha.5 — iter 3"  [2/3 complete]  1 blocked
```

### Hooks Persist Expert Knowledge

The Expert's accumulated knowledge lives in a Hook — Gas Town's mechanism
for persistent state that survives sessions:

```bash
# Expert knowledge is on the lab's hook
gt hooks list
# OUTPUT:
# dx-lab/expert-knowledge  iteration-3  active

# When expert knowledge is updated, the hook advances
# Git worktree tracks every change
```

---

## Custom Beads Types

The DX Lab extends Beads with custom types for research-specific tracking.
Beads supports custom types in the SQLite database (extensible tables).

### Experiment Bead

```
bd create "Tier 1: Bookmark Manager — Worker 1" \
  --type experiment \
  --field tier=1 \
  --field harper-version=5.0.0-alpha.5 \
  --field expert-iteration=3 \
  --field worker-id=1
```

Fields: tier, harper-version, docs-snapshot, expert-iteration, worker-id,
passed, completion-attempts, duration-minutes, blocked-by

### Observation Bead

```
bd create "SWE tried npm install express" \
  --type observation \
  --parent exp-001 \
  --field event=wrong_turn \
  --field self-corrected=true \
  --field correction-time=3min \
  --field classification=doc_gap
```

Fields: event-type, self-corrected, correction-time, how-corrected,
doc-url, classification, severity, expert-action, triage-confidence

### Issue Bead (uses standard Beads, extended)

```
bd create "POST /Bookmark/ returns 500 on valid JSON" \
  --type issue \
  --field classification=bug \
  --field severity=high \
  --field first-seen-version=5.0.0-alpha.3 \
  --field reproduction="1. Create schema with @export ..."
```

Issues use Beads' built-in dependency tracking:
- `blocks`: this bug blocks these experiments
- `discovered-from`: this issue was found by these observations
- `related`: this issue is related to these other issues

### DocPatch Bead

```
bd create "Add @primaryKey requires type ID callout" \
  --type doc-patch \
  --field target-doc="docs/schema-reference" \
  --field patch-content="..." \
  --field status=draft
```

### TierStatus Bead

```
bd create "Tier 1 Status" \
  --type tier-status \
  --field tier=1 \
  --field phase=calibrating \
  --field pass-rate=0.78 \
  --field graduated=false
```

### All types get Beads' built-in features for free:
- Hash-based IDs (multi-worker safe)
- Git-backed persistence
- Full audit trail
- Dependency graph
- Ready-work detection
- JSON export (`--json` flag)
- SQLite for local queries

---

## Formulas: Codified Lab Protocols

Gas Town Formulas are TOML-defined repeatable workflows. The DX Lab's tier
protocols become formulas.

### Tier 1 Run Formula

```toml
# .beads/formulas/tier-1-run.formula.toml
description = "Run a single Tier 1 experiment with one worker"
formula = "tier-1-run"
version = 1

[vars.harper_version]
description = "Harper Docker image tag"
required = true

[vars.expert_iteration]
description = "Expert knowledge iteration to use"
default = "current"

[[steps]]
id = "setup-docker"
title = "Spin up isolated Docker environment"
description = """
Run lab-runner.sh to create Docker stack:
- Harper instance ({{harper_version}})
- Workspace container with assignment
- Isolated network
"""

[[steps]]
id = "run-swe"
title = "Fresh SWE attempts assignment"
description = """
SWE agent receives ONLY:
- Assignment: assignments/tier-1-bookmark-manager.md
- Harper docs URL
- Running Harper instance
SWE works independently. Expert observes silently.
"""
needs = ["setup-docker"]

[[steps]]
id = "expert-review"
title = "Expert completion review"
description = """
When SWE declares done, Expert reviews against pass criteria.
Pass or return with feedback. Record all observations.
"""
needs = ["run-swe"]

[[steps]]
id = "collect-observations"
title = "Collect and classify observations"
description = """
Expert writes observation beads:
- Wrong turns (with self-correction data)
- Stuck points (with hint levels)
- Completion review results
- Issue classification (doc_gap, bug, api_design, etc.)
"""
needs = ["expert-review"]

[[steps]]
id = "teardown"
title = "Tear down Docker environment"
description = "docker compose down. Worker is ephemeral."
needs = ["collect-observations"]
```

### Cohort Formula

```toml
# .beads/formulas/cohort.formula.toml
description = "Run a full cohort: N workers in parallel on a tier"
formula = "cohort"
version = 1

[vars.tier]
description = "Tier number (1-6)"
required = true

[vars.workers]
description = "Number of parallel workers"
default = "3"

[vars.harper_version]
description = "Harper Docker image tag"
required = true

[[steps]]
id = "create-convoy"
title = "Create convoy for this cohort"
description = "gt convoy create 'Tier {{tier}} — {{harper_version}}' --notify"

[[steps]]
id = "spawn-workers"
title = "Spawn {{workers}} parallel workers"
description = """
For each worker:
  bd cook tier-{{tier}}-run --var harper_version={{harper_version}}
  gt sling <experiment-bead> dx-lab
"""
needs = ["create-convoy"]

[[steps]]
id = "await-completion"
title = "Wait for all workers to complete"
description = "Monitor convoy status. Alert if any worker is stuck > 30 min."
needs = ["spawn-workers"]

[[steps]]
id = "aggregate"
title = "Aggregate cohort results"
description = """
Compute: pass rate, avg interventions, self-correction rate,
issue classification breakdown. Update tier-status bead.
"""
needs = ["await-completion"]

[[steps]]
id = "generate-review"
title = "Generate REVIEW.md for human reviewers"
description = """
Produce self-contained review package:
- Summary metrics
- Findings by category (bugs, doc gaps, API friction)
- Draft patches
- Expert performance assessment
"""
needs = ["aggregate"]
```

### Regression Formula

```toml
# .beads/formulas/regression.formula.toml
description = "Run all graduated tiers against a new Harper version"
formula = "regression"
version = 1

[vars.harper_version]
description = "New Harper version to test"
required = true

[[steps]]
id = "identify-graduated"
title = "Find all graduated tiers"
description = "bd list --type tier-status --field graduated=true"

[[steps]]
id = "run-regression"
title = "Run each graduated tier"
description = """
For each graduated tier:
  bd cook cohort --var tier=N --var harper_version={{harper_version}} --var workers=2
"""
needs = ["identify-graduated"]

[[steps]]
id = "compare"
title = "Compare to previous results"
description = """
For each tier: compare pass rate to last known-good.
If regression detected: flag with severity.
"""
needs = ["run-regression"]

[[steps]]
id = "report"
title = "Generate regression report"
description = """
Which tiers passed, which regressed, what broke.
New bugs found. Old bugs fixed. API changes detected.
"""
needs = ["compare"]
```

---

## Querying Lab State

All state is in Beads. Queries use `bd` CLI or direct SQLite.

### Dashboard queries (what the Mayor or you would ask)

```bash
# Tier status overview
bd list --type tier-status --json | jq '.[] | {tier, phase, pass_rate, graduated}'

# Open bugs found by the lab
bd list --type issue --field classification=bug --status open

# What's blocking Tier 2?
bd list --type issue --field tier=2 --status open

# Self-correction rate trend
bd list --type experiment --field tier=1 --json | \
  jq 'group_by(.expert_iteration) | map({iter: .[0].expert_iteration, avg_self_correction: (map(.self_correction_rate) | add / length)})'

# Unreviewed findings
bd list --type doc-patch --field status=draft

# Active convoy progress
gt convoy list

# What's ready to work on?
bd ready
```

### SQLite for heavier analysis

```sql
-- Top hallucination patterns across all experiments
SELECT description, COUNT(*) as frequency, 
       GROUP_CONCAT(DISTINCT json_extract(fields, '$.tier')) as tiers
FROM beads 
WHERE type = 'observation' 
  AND json_extract(fields, '$.event_type') = 'hallucination'
GROUP BY description 
ORDER BY frequency DESC 
LIMIT 20;

-- API design issues sorted by impact
SELECT title, 
       json_extract(fields, '$.worker_frequency') as frequency,
       json_extract(fields, '$.time_cost_minutes') as time_cost
FROM beads 
WHERE type = 'issue' 
  AND json_extract(fields, '$.classification') = 'api_design'
ORDER BY CAST(json_extract(fields, '$.experiment_count') AS INTEGER) DESC;

-- Expert improvement over iterations
SELECT json_extract(fields, '$.expert_iteration') as iter,
       AVG(CASE WHEN json_extract(fields, '$.passed') = 'true' THEN 1 ELSE 0 END) as pass_rate,
       AVG(CAST(json_extract(fields, '$.intervention_count') AS REAL)) as avg_interventions
FROM beads 
WHERE type = 'experiment' AND json_extract(fields, '$.tier') = '1'
GROUP BY iter
ORDER BY iter;
```

---

## What We Keep, What We Drop

### Keep (DX Lab unique contributions)
- Silent observer interaction model
- Stuck hint escalation (Level 1/2/3)
- Issue classification framework (doc_gap, bug, dx_bug, api_design, feature_gap, security)
- Tier system and graduation criteria
- Expert bootstrap loop with versioned knowledge
- Docker isolation per worker (Harper instance + workspace)
- Observation framework (wrong turns, self-corrections, doc fetches)
- Peer review with REVIEW.md packages
- Living platform adaptation (version pinning, regression, plugin testing)
- Per-cohort outputs (patches, skills, CLAUDE.md, pitfalls)

### Drop (replaced by Gas Town / Beads)
- ~~Custom Lab Director~~ → Mayor with DX Lab CLAUDE.md
- ~~Harper-based Experiment Ledger~~ → Beads (JSONL + SQLite + git)
- ~~Custom ingestion pipeline~~ → Agents use `bd` directly
- ~~Custom dashboard queries via REST~~ → `bd list`, `gt convoy`, SQLite
- ~~Custom review gateway script~~ → Convoy notifications + review beads
- ~~Experiment queue management~~ → `bd ready` + formulas
- ~~Custom worker lifecycle~~ → Polecats + hooks
- ~~Custom inter-agent messaging~~ → Gas Town mail + nudges

### Adapt (Gas Town concepts with DX Lab specialization)
- Convoys → Cohorts (convoys with Harper version + tier metadata)
- Polecats → Workers (polecats with Docker isolation layer)
- Hooks → Expert knowledge (hook = expert's persistent state)
- Formulas → Tier protocols (formulas define experiment workflows)
- Witness → Stuck detection (witness configured with DX Lab thresholds)

---

## Getting Started

```bash
# Install prerequisites
brew install gastown         # or: go install github.com/steveyegge/gastown/cmd/gt@latest
brew install beads           # or: go install github.com/steveyegge/beads/cmd/bd@latest

# Create Gas Town workspace
gt install ~/gt --git
cd ~/gt

# Add DX Lab as a rig
gt rig add dx-lab <dx-lab-repo-url>
cd dx-lab

# Initialize Beads with custom types
bd init
# Custom types are defined in .beads/config.yaml

# Create your crew workspace
gt crew add <your-name> --rig dx-lab

# Start the Mayor with DX Lab instructions
gt mayor attach
> "Run a pilot Tier 1 experiment against Harper 5.0.0-alpha.3"
```

The Mayor reads CLAUDE.md, understands the DX Lab protocol, and orchestrates
everything using Gas Town's existing machinery.
