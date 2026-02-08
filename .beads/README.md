# Beads Data

This directory contains the DX Lab's state managed by
[Beads](https://github.com/steveyegge/beads).

All experiments, observations, issues, and outputs are stored as beads
in `beads.jsonl`. The SQLite database (`beads.db`) is a local cache
rebuilt from the JSONL source of truth.

## Custom Types

See `config.yaml` for the DX Lab's custom bead types:
- `experiment` — A worker's run of a tier assignment
- `observation` — A notable event during a run
- `issue` — A durable finding (bug, API friction, etc.)
- `doc-patch` — A proposed documentation fix
- `tier-status` — Aggregated tier health
- `plugin-test` — Plugin quality assessment

## Formulas

The `formulas/` directory contains Gas Town formulas for lab protocols:
- `tier-1-run` — Single worker experiment
- `cohort` — Full cohort (N workers in parallel)
- `regression` — All graduated tiers against a new version
