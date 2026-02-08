# Harper DX Lab

A [Gas Town](https://github.com/steveyegge/gastown) rig that stress-tests
Harper's developer experience. Fresh AI agents attempt Harper tasks using
only the docs. Where they fail, we learn why — broken docs, real bugs,
confusing APIs, missing features — and fix it.

> **Status: Early.** Tier 1 assignment and Docker infrastructure are in place.
> Tiers 2-6 exist as design documents. Expert knowledge is bootstrapped
> (iteration 0) and will evolve through experiment runs.

## How It Works

```
You → Mayor: "Run Tier 1 against Harper alpha.5"

Mayor:
  1. Creates experiment beads
  2. Wraps them in a convoy (cohort)
  3. Spins up Docker stacks (isolated Harper per worker)
  4. Slings assignments to polecats
  5. Expert observes silently, intervenes only when stuck
  6. Collects observations as beads
  7. Generates review package
  8. Notifies: "Cohort complete, awaiting review"
```

Each worker runs two agents: a **Fresh SWE** (zero Harper knowledge, only
docs) and an **Expert** (silent observer, intervenes on stuck/completion).
Workers are isolated — they can't see each other's work.

## What It Finds

When a fresh agent struggles, the root cause is one of:

| Category | Example | Action |
|---|---|---|
| **Doc gap** | Agent writes SQL because REST isn't shown early | Doc patch |
| **Bug** | Agent follows docs, gets 500 error | Bug report with repro |
| **DX bug** | Error says "invalid config" but real issue is missing dep | DX ticket |
| **API friction** | 5/5 agents try batch insert, doesn't exist | API proposal with data |
| **Feature gap** | Agent tries caching, not in v5 open source | Feature request |
| **Security** | Default config exposes ops API on all interfaces | Immediate fix |

## Prerequisites

- [Gas Town](https://github.com/steveyegge/gastown) (`gt`) — multi-agent workspace manager
- [Beads](https://github.com/steveyegge/beads) (`bd`) — persistent state tracking for coding agents
- Docker / Docker Compose
- Claude Code (or other agent runtime)

## Quick Start

```bash
# In your Gas Town workspace
gt rig add dx-lab <this-repo-url>
cd dx-lab

# Initialize beads
bd init

# Set up Docker credentials
cp docker/.env.example docker/.env
# Edit docker/.env if you want non-default credentials

# Set up expert knowledge symlink
cd expert-knowledge && ln -sf iteration-0 current && cd ..

# Start the Mayor
gt mayor attach

# Tell it what to do
> "Run a pilot Tier 1 experiment against Harper 5.0.0-alpha.3"
```

## Project Structure

```
harper-dx-lab/
├── CLAUDE.md                    # Mayor = Lab Director instructions
├── AGENTS.md                    # Agent roles (Expert, Fresh SWE)
├── .beads/
│   ├── config.yaml              # Custom bead types
│   └── formulas/                # Tier protocols as Gas Town formulas
│       ├── tier-1-run.formula.toml
│       ├── cohort.formula.toml
│       └── regression.formula.toml
├── assignments/                 # Tier assignment files (what SWEs receive)
│   └── tier-1-bookmark-manager.md
├── docker/                      # Per-worker Docker isolation
│   ├── docker-compose.worker.yml
│   ├── lab-runner.sh
│   └── .env.example
├── expert-knowledge/            # Versioned expert knowledge (on a Hook)
│   ├── current -> iteration-N/
│   └── iteration-0/
│       ├── skills/              # SKILL.md files for Claude Code
│       ├── references/          # Harper doc snapshots, examples
│       ├── pitfalls.md          # Known wrong turns and corrections
│       └── memory.md            # Persistent expert rules
├── design/                      # Design docs (reference, not operational)
└── reviews/                     # Human review packages
```

## Tiers

| Tier | Challenge | Tests | Status |
|---|---|---|---|
| 1 | CRUD app (bookmark manager) | Schema, REST, @export, basic queries | Assignment ready |
| 2 | Relationships (recipe book) | @relationship, nested queries, indexes | Design only |
| 3 | Custom resources (REST API) | Resource classes, middleware, auth | Design only |
| 4 | Real-time (chat/dashboard) | MQTT, subscriptions, WebSocket | Design only |
| 5 | Advanced (vector search) | Embeddings, hybrid queries, caching | Design only |
| 6 | Full application | All of the above, production patterns | Design only |

## State

All lab state lives in [Beads](https://github.com/steveyegge/beads). No external database.

```bash
bd list --type experiment          # All experiments
bd list --type observation         # All observations
bd list --type issue               # All issues found
bd list --type tier-status         # Tier health
gt convoy list                     # Active cohorts
```

## Design Docs

Detailed design documentation is in `design/`. Start with:
- [gas-town-integration.md](design/gas-town-integration.md) — Architecture ([Gas Town](https://github.com/steveyegge/gastown) + [Beads](https://github.com/steveyegge/beads) integration)
- [living-platform.md](design/living-platform.md) — Evolving Harper, triage
- [agents.md](design/agents.md) — Agent interaction model

## License

MIT
