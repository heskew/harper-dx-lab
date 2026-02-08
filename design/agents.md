## Team Composition: The Two-Agent Worker

The original design had a solo fresh SWE per worker. That captures doc failures
but misses a critical signal: **what does the correction look like?**

When a fresh SWE hallucinates `db.query("SELECT * FROM ...")`, we know there's
a doc gap. But what's the right answer? What should the docs have said? A solo
agent just fails. A team of two gives us both the failure AND the correction.

### Per-Worker Team

Each isolated Docker worker runs two agents:

**Fresh SWE (the test subject)**
- Senior engineer, experienced with Node.js/React/databases, zero Harper knowledge
- Gets ONLY: the assignment + Harper docs URL + running Harper instance
- No skills, no CLAUDE.md, no hints
- This agent's struggles are the data

**Harper Expert (the observer)**
- Same senior engineer baseline, but equipped with accumulated Harper knowledge
- Gets: everything the Fresh SWE gets PLUS current skills, CLAUDE.md, memory files
- **Silently observes** the Fresh SWE's work — does NOT proactively intervene
- Speaks up at exactly two moments (see Interaction Model below)
- Logs everything it observes, even when it doesn't intervene

### Interaction Model

The Expert is a **silent observer**, not a pair programmer. It watches the SWE
work and keeps a detailed log of what's happening, but only speaks at two
specific moments:

**Trigger 1 — Stuck Detection**
When the SWE has been stuck on the same problem for a threshold period (e.g.,
5+ minutes with no progress, or 3+ failed attempts at the same thing), the
Expert provides a minimal hint — just enough to unblock, not a full solution.

**Trigger 2 — Completion Review**
When the SWE declares the assignment complete, the Expert reviews the solution
against the tier's pass criteria and either passes it or returns it with
specific feedback. The SWE then iterates based on feedback.

```
Timeline of a typical Tier 1 run:

10:00  SWE reads assignment, starts working
10:02  SWE fetches Harper docs, reads getting-started
10:05  SWE tries: npm install express
       Expert: [OBSERVES — logs: "wrong_mental_model, Express server"]
       Expert: [SILENT — SWE hasn't been stuck yet, just started]
10:07  SWE reads more docs, finds @export
10:08  SWE: "Oh wait, I don't need Express"
       Expert: [OBSERVES — logs: "self_corrected, Express → @export, 3 min"]
       Expert: [SILENT — SWE self-corrected, this is great data]
10:12  SWE writes schema, deploys, gets error
10:14  SWE re-reads schema docs, tries again, gets same error
10:17  SWE tries a third variation, still stuck
       Expert: [STUCK DETECTED — 5 min, 3 attempts on schema deployment]
       Expert → SWE: "Hint: Check that your @primaryKey field uses type ID,
                      not String. Harper requires ID type for primary keys."
       Expert: [LOGS — intervention: stuck_hint, topic: schema_primaryKey,
               doc_gap: "schema docs don't call out ID type requirement clearly"]
10:19  SWE fixes schema, deploys successfully
10:25  SWE implements CRUD operations, tests with curl
10:32  SWE implements tag filtering
10:38  SWE: "Assignment complete. All CRUD operations working."
       Expert: [COMPLETION REVIEW]
       Expert → SWE: "NOT PASSED. Two issues:
                      1. You used @primaryKey but didn't add @indexed on 'tags'.
                         Filtering by tag works now but won't scale — Harper needs
                         @indexed for efficient queries on non-PK fields.
                      2. Your tag filter uses ?tags=database but the assignment
                         asks for partial title search, which you haven't implemented.
                         Look into the REST query parameters for string matching."
       Expert: [LOGS — completion_review: fail, issues: [missing_index, missing_feature],
               doc_gap: "@indexed importance not emphasized in getting-started"]
10:45  SWE adds @indexed, implements title search
10:48  SWE: "Updated — ready for re-review"
       Expert: [COMPLETION REVIEW]
       Expert → SWE: "PASSED. Schema uses @indexed correctly, all CRUD operations
                      work, tag filtering and title search both functional. Clean
                      Harper patterns throughout — no SQL, no Express, no external
                      dependencies."
       Expert: [LOGS — completion_review: pass, attempts: 2, total_time: 48min,
               interventions: 1 (stuck_hint), self_corrections: 1]
```

### Why Silent Observer > Active Pair Programming

The silent observer model gives you **cleaner research data**:

| Signal | Active Pair | Silent Observer |
|---|---|---|
| What SWE can figure out alone | ❌ Contaminated by expert help | ✅ Pure signal |
| Self-correction patterns | ❌ Expert intervenes before SWE can self-correct | ✅ Captured (Express → @export example above) |
| True stuck points vs temporary confusion | ❌ Expert can't distinguish | ✅ Threshold separates them |
| Doc sufficiency | ❌ Expert masks doc gaps | ✅ SWE either finds it in docs or doesn't |
| Completion quality | ✅ Expert ensures correctness | ✅ Same — completion review catches gaps |
| Expert intervention log | ⚠️ Noisy — many small interventions | ✅ Clean — only real stuck points + completion |

The key insight: **self-corrections are the most valuable data point.** When
the SWE tries Express, reads more docs, and figures out @export on their own —
that means the docs worked. If the expert had intervened at the Express moment,
you'd never know the docs were sufficient. The silent observer lets those
self-corrections happen naturally.

### Hint Escalation

When the Expert does intervene at a stuck point, hints should be minimal
and escalate only if needed:

```
Level 1 — Direction: "Look at the schema docs section on field types."
Level 2 — Specific: "Check that your @primaryKey uses type ID, not String."
Level 3 — Answer:   "Change `title: String @primaryKey` to `id: ID @primaryKey`."
```

The Expert starts at Level 1. If the SWE is still stuck after 2-3 more minutes,
escalate to Level 2. Level 3 is a last resort — it means the docs completely
failed for this concept and a direct answer was the only way forward.

The hint level used is recorded in the observation log. More Level 1 hints =
docs just need better signposting. More Level 3 hints = docs are fundamentally
missing information.

---

## The Three-Layer Review Chain

Each experiment passes through three layers of review, each producing different
kinds of feedback that improve different parts of the system.

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: Expert Agent (automated, per-run)                      │
│                                                                  │
│ Reviews: SWE's solution against tier pass criteria               │
│ Produces: pass/fail, intervention log, identified doc gaps       │
│ Feeds into: next Expert iteration (skills, pitfalls, memory)    │
│ Happens: during every run, automatically                         │
└──────────────────────────────┬──────────────────────────────────┘
                               │ completed experiments
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2: Lab Director (automated, per-cohort)                    │
│                                                                  │
│ Reviews: cross-worker patterns from a cohort                     │
│ Produces: aggregated analysis, draft doc patches, draft skills   │
│ Feeds into: human review queue                                   │
│ Happens: after each cohort completes                             │
└──────────────────────────────┬──────────────────────────────────┘
                               │ draft improvements
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3: Human Expert (manual, quality gate)                     │
│                                                                  │
│ Reviews: everything Layers 1 and 2 produced                      │
│ Produces:                                                        │
│   - Approved/modified doc patches → PR to Harper docs repo       │
│   - Validated/corrected skills → Expert knowledge for next iter  │
│   - Expert agent feedback → "you missed X" or "Y was wrong"     │
│   - Doc writer feedback → "this patch wording is misleading"     │
│   - Tier graduation decisions                                    │
│   - New experiment ideas based on patterns noticed               │
│ Feeds into: EVERYTHING — expert agent, doc writer, lab director  │
│ Happens: async, on your schedule                                 │
└─────────────────────────────────────────────────────────────────┘
```

### What the Human Expert Reviews

When you sit down to review, you're looking at a package per cohort:

```
Cohort D — Tier 2 (Relationships) — 3 workers — Expert Iteration 2

SUMMARY
  Pass rate: 2/3
  Total expert interventions: 4 (1 stuck hint, 3 completion feedback items)
  Self-corrections observed: 6
  New doc gaps identified: 3

EXPERT INTERVENTION LOG
  Worker 1:
    [Stuck hint @ 14min] SWE couldn't find relationship syntax.
    Hint given (Level 2): "Use @relationship(from: fieldName) in schema.graphql"
    → Doc gap: relationship syntax buried in reference, not in tutorial flow

  Worker 2:
    [Completion review — FAIL] SWE used manual JOIN logic in JS instead of
    select() with nested relationships. Solution works but misses Harper's
    strength. Expert sent back with feedback.
    → Doc gap: no example showing "what NOT to do" vs Harper-native approach

  Worker 3:
    [Completion review — PASS on first attempt] Clean solution, proper
    relationships, nested select() queries.
    → Signal: docs were sufficient for this SWE (no interventions needed)

SELF-CORRECTIONS OBSERVED (no expert involvement)
  - 3/3 workers initially tried SQL joins → found REST docs → self-corrected
  - 2/3 workers initially missed @indexed on FK fields → got empty relationship
    results → re-read schema docs → self-corrected
  - 1/3 workers tried Express → found @export → self-corrected

DRAFT DOC PATCHES (for your review)
  1. [relationships.md] Add "Quick Start" example at top showing
     @relationship + select() in 3 steps
  2. [relationships.md] Add "Common Mistake" callout: manual JS joins
     vs native relationship queries
  3. [schema.md] Add note: "@indexed is required on FK fields for
     relationships to resolve"

DRAFT SKILL UPDATES
  - harper-relationships/SKILL.md: Added section on @indexed + FK requirement
  - harper-relationships/pitfalls.md: Added "manual join" anti-pattern

YOUR ACTIONS NEEDED
  □ Review 3 doc patches — approve / modify / reject each
  □ Review skill updates — confirm accuracy
  □ Assess: Expert missed that Worker 2's manual JOIN still "worked" —
    should Expert be stricter about Harper-native patterns?
  □ Decide: Tier 2 at 67% pass — run another cohort or adjust docs first?
```

### Human Feedback Loops

Your review doesn't just approve outputs — it improves the agents themselves.

**Feedback to Expert Agent:**
"You let Worker 2 pass initially even though they used manual JS joins.
The completion review should check for this anti-pattern. Add to your
review checklist: verify that relationship data is resolved via select()
with nested attributes, not via manual lookups in custom resource code."

→ This gets added to the Expert's prompt/knowledge for the next iteration.

**Feedback to Doc Writer (the process that generates doc patches):**
"Patch #2 says 'don't use manual joins' but doesn't show WHY the Harper
way is better. Add a concrete comparison: show the manual approach (5 lines
of JS, N+1 queries) vs the Harper approach (one URL with nested select).
Make the performance difference obvious."

→ This improves the quality of future draft doc patches.

**Feedback to Lab Director:**
"Tier 2 is failing mostly on the relationship query syntax, not the schema
definition. Split the next cohort: run 2 workers on the current assignment
and 1 worker on a simplified version that only tests relationship SCHEMA
(no complex queries). This will isolate whether the gap is in schema docs
or query docs."

→ This improves experiment design for future cohorts.

Over time, these feedback loops compound. The Expert gets better at reviewing.
The doc patches get better-worded. The Lab Director gets better at designing
experiments. And you spend less time per review because the quality of what's
presented to you keeps improving.

### The Bootstrap Loop

The expert doesn't become reliable in 3 iterations. Different tiers, different
reviewers, different edge cases — each adds a layer. Plan for 5-10+ iterations
per tier, with the early ones moving fast and later ones being refinement.

```
Phase: "Cold Start" (Iterations 0–2)
  What happens:
  ├── Expert is essentially another fresh SWE with a clipboard
  ├── Stuck hints are often wrong or too vague
  ├── Completion reviews miss anti-patterns (passes things that "work" but badly)
  ├── Human review is heavy — correcting the expert is the main work
  ├── Different human reviewers catch different blind spots
  └── Output: raw baseline data, first hallucination catalog, expert calibration begins

  Expert quality: ★☆☆☆☆ → ★★☆☆☆
  Human review load: ~100% of runs reviewed
  Typical iterations: 2-3

Phase: "Calibrating" (Iterations 3–6)
  What happens:
  ├── Expert recognizes common hallucination patterns and waits appropriately
  ├── Stuck hints are usually helpful, occasionally miscalibrated
  ├── Completion reviews catch most issues but miss subtle ones
  ├── Each new human reviewer who joins adds perspective the expert lacked
  │   (e.g., someone from the Harper core team catches perf anti-patterns
  │    that a prior reviewer focused on correctness wouldn't catch)
  ├── Human review shifting from correction to confirmation
  └── Output: draft skills, doc patches, pitfall catalog taking shape

  Expert quality: ★★☆☆☆ → ★★★☆☆
  Human review load: ~50% of runs reviewed
  Typical iterations: 3-4

Phase: "Reliable" (Iterations 7–10+)
  What happens:
  ├── Expert completion reviews match human expert quality for graduated tiers
  ├── Stuck hints well-calibrated — right level, right timing
  ├── New tiers still need heavy human review (expert hasn't seen these patterns)
  ├── Graduated tiers need only periodic spot-checks
  ├── Peer reviewers now reviewing the expert's PROCESS, not just outputs
  └── Output: mature skills, comprehensive doc patches, architecture patterns

  Expert quality: ★★★☆☆ → ★★★★☆
  Human review load: ~20% of runs (spot-check), 100% for new tiers
  Typical iterations: 3-4+

Phase: "Autonomous" (Iteration N)
  What happens:
  ├── Expert can handle all graduated tiers with minimal human oversight
  ├── Human review only for: new tiers, tier graduation decisions, and audits
  ├── Expert knowledge is comprehensive enough to be the distributed product
  └── New human reviewers' corrections become rare (expert already knows)

  Expert quality: ★★★★★
  Human review load: new tiers + periodic audits only
  This phase may never fully arrive — and that's fine. The improvement
  curve is what matters, not reaching perfection.
```

**Key insight: iteration count scales with tier count, not just time.**
Tier 1 might reach "Reliable" in 5 iterations. Tier 4 (MQTT/real-time)
might take 10+ because the problem space is bigger. Each tier has its own
iteration counter and can be at a different phase.

**The Expert gets better in three ways simultaneously:**
1. **Accumulated knowledge** — each iteration adds skills, pitfalls, and patterns
2. **Human calibration** — reviewer feedback teaches the expert HOW to observe,
   WHEN to hint, and WHAT to check during completion review
3. **Diverse perspectives** — different human reviewers catch different things.
   One reviewer catches architecture issues. A Harper core team member catches
   performance anti-patterns. A community contributor catches onboarding friction.

The third channel is why multiple human reviewers matter. A single reviewer
creates a single perspective. Multiple reviewers create comprehensive coverage.

**The Expert agent IS the product.** When the Expert can observe any fresh SWE
through any tier and the SWE completes with zero stuck hints and passes
completion review on the first attempt, the documentation and skills are
complete. The Expert's accumulated knowledge is exactly what gets packaged
into skills, CLAUDE.md templates, and doc patches for distribution.

### Expert Knowledge Packaging

The Expert's knowledge lives in files that accumulate across iterations:

```
expert-knowledge/
├── iteration-0/          # Empty — baseline run
├── iteration-1/
│   ├── skills/           # First draft skills from Iteration 0 analysis
│   ├── pitfalls.md       # Initial hallucination patterns
│   └── memory.md         # "Don't do X, do Y" rules
├── iteration-2/
│   ├── skills/           # Refined skills
│   ├── pitfalls.md       # Expanded
│   └── memory.md         # Expanded
├── current -> iteration-2/   # Symlink to latest
└── expert-prompt.md          # System prompt that references current/
```

Each iteration's knowledge is immutable. The Expert always reads from `current/`.
After analysis, the lead (or Lab Director) updates the symlink to the next iteration.
This gives you a clear audit trail of how the Expert evolved.

