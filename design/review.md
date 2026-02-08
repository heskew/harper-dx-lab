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

---

## Peer Review & Collaboration

The lab needs more than one human expert. Different reviewers bring different
perspectives — Harper core team members know internals, developers from other
teams catch onboarding friction, community contributors spot assumptions that
insiders are blind to.

### The Problem With a Single Reviewer

```
A single reviewer reviews everything:
├── Catches: architecture issues, pattern correctness, Harper best practices
├── Misses: things that seem obvious to them but aren't to newcomers
├── Misses: performance implications only a Harper internals person would know
├── Misses: accessibility and UX patterns a frontend specialist would catch
└── Bottleneck: nothing can graduate when that person is busy
```

### Review Roles

Not every reviewer needs to review everything. Different people review
different aspects:

```yaml
reviewers:
  - id: lab-lead
    role: "Lab Lead"
    reviews: [tier_graduation, architecture, expert_calibration, experiment_design]
    availability: "primary, reviews most runs"

  - id: harper-core-member
    role: "Harper Expert"
    reviews: [harper_patterns, performance, schema_design, doc_accuracy]
    availability: "periodic, reviews flagged items"
    value: "catches when expert passes solutions that work but are slow/wrong"

  - id: community-dev
    role: "Fresh Eyes"
    reviews: [onboarding_friction, doc_clarity, getting_started_flow]
    availability: "async, reviews doc patches and getting-started rewrites"
    value: "catches assumptions — 'this is obvious' often isn't"

  - id: harper-dx-person
    role: "DX Advocate"
    reviews: [skill_quality, claude_md_templates, error_messages, pitfall_catalog]
    availability: "periodic, reviews output artifacts"
    value: "ensures outputs are actually useful to real developers"
```

### Review Sharing Mechanism

Reviewers shouldn't need to install anything, clone repos, or run Docker.
They just need to see what happened and leave feedback.

**Per-Cohort Review Package**

After each cohort completes, the Lab Director generates a self-contained
review package — a markdown file (or small set of files) that contains
everything a reviewer needs:

```
reviews/
├── cohort-20260210-tier2/
│   ├── REVIEW.md                 # ← This is what gets shared
│   ├── worker-1-observations.yaml
│   ├── worker-2-observations.yaml
│   ├── worker-3-observations.yaml
│   └── draft-patches/
│       ├── patch-001-relationship-quickstart.md
│       ├── patch-002-indexed-on-fk.md
│       └── patch-003-manual-join-antipattern.md
```

**REVIEW.md** is the shareable artifact. It contains:

```markdown
# Cohort Review: Tier 2 — Relationships
**Date**: 2026-02-10 | **Expert Iteration**: 4 | **Workers**: 3

## Summary
- Pass rate: 2/3 (Worker 2 failed completion review, passed on retry)
- Self-corrections: 8 (docs handled SQL→REST, Express→@export)
- Stuck hints needed: 2 (schema @primaryKey type, relationship syntax)
- Completion review issues: 3 (missing @indexed, manual joins, incomplete feature)

## What Worked (docs sufficient)
- All 3 workers discovered @export without help
- 2/3 workers found relationship syntax in docs (1 needed hint)

## What Didn't (doc gaps identified)
1. **@primaryKey type requirement** — 2/3 workers stuck for 5+ min
   - Current docs: [link to schema page]
   - Gap: Type ID requirement not stated
   - Draft fix: [link to patch-001]

2. **Relationship query nesting** — 1/3 workers needed hint
   - Current docs: [link to REST page]
   - Gap: No example of select() with nested relationships
   - Draft fix: [link to patch-002]

3. **"It works" ≠ "It's right"** — Worker 2 used manual JS joins
   - Expert caught this on completion review
   - Draft fix: [link to patch-003] — add anti-pattern callout

## Draft Patches (your review needed)
### Patch 001: Relationship Quick Start
[full patch content inline — reviewer can read without opening files]

### Patch 002: @indexed on FK fields
[full patch content inline]

### Patch 003: Manual Join Anti-pattern
[full patch content inline]

## Expert Performance
- Stuck detection: appropriate timing (2/2 interventions were justified)
- Completion review: caught manual join anti-pattern ✓
- Missed: nothing identified (but please flag if you see something)

## Your Feedback
Leave feedback by:
- Editing this file and committing (if you have repo access)
- Replying to the message/email this was shared in
- Adding comments in the GitHub PR (if patches are already PR'd)

For each patch, please note:
- [ ] Approve as-is
- [ ] Approve with modifications (describe)
- [ ] Reject (explain why)
- [ ] Need more context
```

### Sharing Methods

The review package is just files. It can be shared however works for the reviewer:

**GitHub PR** (preferred for doc patches):
  Lab Director creates a branch with patches, opens a PR, adds reviewers.
  Discussion happens inline on the PR. Standard workflow.

**Shared folder / Google Drive**:
  Drop REVIEW.md + patches in a shared folder. Reviewer reads, replies
  with feedback via whatever channel (Slack, email, comments in the doc).

**Email / Slack**:
  For quick reviews, paste the REVIEW.md summary directly. Reviewer
  responds inline. Works well for community contributors who don't
  want repo access.

**Git repo** (for persistent reviewers):
  The `reviews/` directory lives in the dx-lab repo. Reviewers with
  access can browse history, see how cohorts evolved, leave feedback
  as commits or issues.

### Feedback Format

To keep things structured without being burdensome, reviewers use a simple format:

```markdown
## Review by: [name] | Role: [role] | Date: [date]

### Patch 001: Relationship Quick Start
**Decision**: Approve with modifications
**Notes**: Good content, but the example uses a Shipment/Carrier relationship
  which is domain-specific. Use something more universal like User/Post or
  Recipe/Ingredient so it's immediately relatable.

### Patch 003: Manual Join Anti-pattern
**Decision**: Approve as-is
**Notes**: This is exactly the kind of thing new developers need to see.
  The side-by-side comparison (manual vs native) is compelling.

### Expert Feedback
The expert should have caught that Worker 3's schema didn't use @createdTime
or @updatedTime. These are free features in Harper and any production app
should use them. Add to expert's completion review checklist.

### New Experiment Idea
Would be useful to have a variant of Tier 2 where the assignment specifically
requires sorting by creation date — this would force SWEs to discover
timestamp handling in Harper.
```

### Reviewer Onboarding

New reviewers need minimal context. The REVIEW.md format is self-contained,
but for recurring reviewers, a one-page "How to Review DX Lab Results"
guide explains:

1. What the lab is (2 paragraphs)
2. What you're looking at (cohort results + draft improvements)
3. What to focus on (based on your role — see Review Roles above)
4. How to give feedback (see format above)
5. How your feedback gets used (improves expert, docs, and skills)

---

