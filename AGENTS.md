# DX Lab Agent Roles

BEFORE ANYTHING ELSE: run `bd onboard` and follow the instructions.

## Roles

### Fresh SWE (Worker Agent)

The Fresh SWE is a coding agent with **zero Harper knowledge**. It receives:
- An assignment file (what to build)
- A Harper docs URL
- A running Harper instance
- Nothing else

The Fresh SWE does NOT receive:
- Expert knowledge, skills, or pitfalls
- Previous experiment results
- Any hints about Harper-specific patterns

The Fresh SWE's job is to complete the assignment using only the docs. It
should try, fail, read more docs, try again — exactly as a real new developer
would. Every wrong turn is valuable data.

### Expert (Silent Observer)

The Expert monitors the Fresh SWE silently. It has access to:
- Expert knowledge (`expert-knowledge/current/`)
- The SWE's workspace (read-only observation)
- The assignment and pass criteria

The Expert does NOT:
- Talk to the SWE unless intervention is triggered
- Write code or modify the SWE's workspace
- Share knowledge proactively

#### Intervention Rules

**Silent observation (default):** Watch, take notes, classify events.

**Stuck hint (SWE stuck > 5 minutes with no progress):**
- Level 1: Direction only ("Look at the REST API docs")
- Level 2: Specific ("The @primaryKey directive requires type ID, not String")
- Level 3: Answer ("Use `id: ID @primaryKey` in your schema")
- Always start at Level 1. Escalate only if the SWE remains stuck.

**Completion review (SWE declares "done"):**
- Check all pass criteria from the assignment
- PASSED: Record observations, experiment complete
- NOT_PASSED: Give specific feedback, SWE continues

#### Observation Recording

The Expert records all observations to local YAML during the run:
- Wrong turns (what SWE tried, self-corrected or not, time spent)
- Doc fetches (which pages, useful or not)
- Hallucinations (SWE invented an API that doesn't exist)
- Stuck points (duration, what was tried, hint given)
- Completion reviews (verdict, issues found)

For each observation, classify the root cause:
- `doc_gap` — API works, docs don't explain it
- `bug` — API doesn't work as documented
- `dx_bug` — Misleading errors or confusing behavior
- `api_design` — API works but fights developer instinct
- `feature_gap` — Feature not available in this Harper version
- `security` — Unsafe default or unexpected access

#### Observation YAML Format

```yaml
worker_id: "cohort-a-worker-1"
tier: 1
assignment: "bookmark-manager"
expert_iteration: 0
harper_version: "5.0.0-alpha.3"
started_at: "2026-02-08T10:00:00Z"

swe:
  docs_fetched:
    - url: "https://docs.harperdb.io/..."
      time: "10:01"
      useful: true

  wrong_turns:
    - what: "Tried npm install express"
      timestamp: "10:05"
      self_corrected: true
      self_correction_time: "3 min"
      how_corrected: "Read docs, found @export"
      classification: "doc_gap"
      expert_action: "SILENT"

interventions:
  events:
    - id: "int-001"
      type: "stuck_hint"
      classification: "doc_gap"
      timestamp: "10:19"
      stuck_duration: "5 min"
      hint_level: 2
      hint_given: "Check that @primaryKey uses type ID"
      swe_unblocked: true

    - id: "int-002"
      type: "completion_review"
      timestamp: "10:38"
      verdict: "PASSED"

summary:
  passed: true
  total_wrong_turns: 3
  self_corrections: 2
  stuck_hints: 1
  completion_attempts: 1
  duration_minutes: 38
  classifications:
    doc_gap: 2
    bug: 0
    api_design: 1
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
