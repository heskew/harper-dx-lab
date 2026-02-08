# Living Platform: How the Lab Adapts to an Evolving Harper

The DX Lab was originally framed as "test the docs." But Harper v5 is open source,
alpha-state, and actively evolving. The docs aren't the only thing that might be
broken — the platform itself might be. This changes the lab from a documentation
testing tool into something broader: **a continuous developer experience sensor
for a living platform.**

---

## The Alpha Reality

Harper v5 open source is a different animal from the enterprise ("Unleashed")
product. It's early. Things will change, break, get redesigned, and stabilize
at different rates. The lab needs to handle all of this.

```
What the Lab was designed to find:
  "The docs don't explain @export clearly enough"     → Doc patch

What the Lab will ALSO find (because Harper is alpha):
  "The @export directive silently fails with no error" → Bug report
  "The error message says 'invalid schema' but the
   schema is valid — the real issue is a missing dep"  → DX bug report
  "This API requires 6 steps to do something that
   should take 2"                                      → API design feedback
  "This feature is documented but doesn't actually
   work yet in v5 open source"                         → Feature gap report
  "The REST endpoint returns 200 OK but the data
   is silently wrong"                                  → Critical bug report
```

**This is MORE valuable than testing docs alone.** Fresh agents are the cheapest,
most honest integration testers you can get. They try things exactly as documented,
with zero workarounds. If something doesn't work as described, they surface it
immediately — no "oh I know about that bug, I just work around it" institutional
knowledge masking real problems.

---

## Observation Triage: Not Everything Is a Doc Gap

The current observation framework assumes every failure is a documentation gap.
With an alpha platform, failures fall into distinct categories that need different
responses:

### Category 1: Doc Gap (original focus)
**Signal:** Agent tries the wrong approach, docs don't guide them to the right one.
**Example:** Agent writes SQL queries because docs don't explain REST endpoints early enough.
**Action:** Doc patch.
**Owner:** Docs team / DX Lab.

### Category 2: Actual Bug
**Signal:** Agent follows docs correctly but the feature doesn't work as described.
**Example:** Agent creates schema with `@export`, deploys, but REST endpoint returns 404.
**Action:** Bug report with reproduction steps (the agent's exact steps ARE the repro).
**Owner:** Harper core team.
**Lab value:** The observation log is a perfect bug report — exact steps, exact
error, exact environment. No "steps to reproduce" guesswork.

### Category 3: DX Bug (bad errors, confusing behavior)
**Signal:** Feature works but the error messages, status codes, or behavior is misleading.
**Example:** Agent gets `Error: invalid configuration` when the real issue is a
missing npm dependency. Or agent gets a 200 OK but the response body is empty
with no indication why.
**Action:** DX improvement ticket — better error messages, validation, feedback.
**Owner:** Harper core team, informed by DX Lab data.
**Lab value:** Agents don't guess what errors mean. They take them literally.
If an error message is misleading, the agent will go down the wrong path — and
that's exactly the data you need to improve the error message.

### Category 4: API Design Issue
**Signal:** Agent can make it work but the path is unreasonably complex, or the
agent consistently reaches for a pattern that would be natural but doesn't exist.
**Example:** Every fresh SWE tries to do a batch insert, but Harper only supports
one-at-a-time POST. Or every SWE expects `DELETE /Table/id` but the actual
endpoint is something different.
**Action:** API design feedback — "N out of N fresh developers expected this to
work this way." Strongest possible signal for API improvement.
**Owner:** Harper core team / architecture decisions.
**Lab value:** This is the lab's most unique contribution. You can't get this
signal from experienced Harper developers — they already know the workarounds.
Only fresh agents (or fresh humans) reveal what the "natural" expectation is.

### Category 5: Feature Gap (v5 open source vs Unleashed)
**Signal:** Feature is documented (maybe from Unleashed docs) but doesn't exist
in the open source version.
**Example:** Agent reads about caching in docs, tries to use it, it's not available
in v5 open source.
**Action:** Feature gap tracking — document what's in v5 OS vs what's Unleashed-only.
**Owner:** Harper product team.
**Lab value:** Reveals which Unleashed features developers reach for first. This
is a prioritization signal for what to open-source next, or what to clearly mark
as "Unleashed-only" in docs.

### Category 6: Security Concern
**Signal:** Agent creates something that works but is insecure, or discovers that
a default configuration is insecure.
**Example:** Agent creates a public REST endpoint with no authentication because
the getting-started guide doesn't mention auth. Or agent discovers that the default
Harper config exposes the operations API on all interfaces.
**Action:** Security review + doc fix + potentially a default configuration change.
**Owner:** Harper security team, escalated immediately.
**Lab value:** Fresh agents build things exactly as documented with no security
hardening. If the docs lead to insecure defaults, the lab catches it before
real users ship insecure apps.

### Updated Observation Template

The per-worker observation now includes a triage field:

```yaml
wrong_turns:
  - what: "POST /Bookmark/ returns 500 with valid JSON body"
    timestamp: "10:12"
    self_corrected: false
    stuck_duration: "8 min"
    expert_action: "STUCK_HINT"

    # NEW: Triage classification
    triage:
      category: "bug"              # doc_gap | bug | dx_bug | api_design | feature_gap | security
      confidence: "high"           # high | medium | low (expert's confidence in classification)
      description: "POST endpoint returns 500 on valid payload. Tested with curl
                    from host — same result. This is not a doc issue."
      severity: "high"             # for bugs/security: high | medium | low
      reproduction: |
        1. Create schema with Bookmark table having @export
        2. Deploy (succeeds)
        3. POST /Bookmark/ with body: {"title": "test", "url": "https://example.com"}
        4. Returns 500 Internal Server Error
        5. Harper logs show: TypeError: Cannot read property 'id' of undefined
      suggested_owner: "harper-core"
      blocks_experiment: true      # Did this prevent the SWE from completing?
```

### Triage in the Review Package

The cohort REVIEW.md now groups findings by category:

```markdown
## Findings by Category

### Bugs (2 found — need Harper core attention)
1. **POST 500 on valid payload** [HIGH] — Worker 1, 2 both hit this.
   Reproduction steps attached. Blocks tier completion.
2. **MQTT subscribe silently drops messages > 1MB** [MEDIUM] — Worker 3
   discovered during Tier 4. Not documented anywhere.

### DX Bugs (1 found)
1. **Schema deploy error message is misleading** [MEDIUM] — Says "invalid
   schema" when the real issue is a type mismatch on @primaryKey. 2/3
   workers went down the wrong debugging path.

### API Design Observations (1 found)
1. **No batch insert** — 3/3 workers tried to POST an array of records.
   All had to discover one-at-a-time insertion independently. Strong signal
   that batch insert is a natural expectation.

### Doc Gaps (3 found — standard lab output)
1. @indexed importance not emphasized...
2. Relationship query nesting not shown...
3. ...

### Feature Gaps (1 found — v5 OS vs Unleashed)
1. **Caching** — Worker 2 tried to use caching based on docs. Not available
   in v5 open source. Docs don't distinguish OS vs Unleashed features.
```

---

## Version Management

Harper is a moving target. The lab needs to handle version changes gracefully
and use them as a feature, not fight them.

### Version Pinning

Every experiment is pinned to a specific Harper version:

```yaml
experiment:
  harper_version: "5.0.0-alpha.3"     # Exact version
  harper_image: "harperdb/harperdb:5.0.0-alpha.3"
  docs_snapshot: "2026-02-15"          # Date docs were fetched
  expert_iteration: 4
```

This matters because:
- Results are only comparable across the same Harper version
- A "regression" means "this used to pass on alpha.2, now fails on alpha.3"
- Doc patches should reference which version they apply to

### Version Progression Strategy

```
Harper v5.0.0-alpha.1
├── Run Tier 1 baseline (3 workers)
├── Identify: which failures are doc gaps vs alpha bugs?
├── File bug reports for real bugs
├── Write doc patches for doc gaps
├── Mark known bugs as "blocked_by: alpha bug #123"
└── Don't try to graduate tiers blocked by real bugs

Harper v5.0.0-alpha.2 (bugs from alpha.1 fixed)
├── Re-run Tier 1 (previously blocked experiments should now pass)
├── Continue Tier 2 scouting
├── Compare: alpha.1 results vs alpha.2 results
│   - Bugs fixed? ✓ Verify experiments that were blocked now pass
│   - New bugs? Surface them early
│   - API changes? Update skills and doc patches
└── Expert iteration advances with new knowledge

Harper v5.0.0-beta.1 (API stabilizing)
├── Full Tier 1-3 cohorts — APIs are stable enough to graduate
├── Start Tier 4-5 if features are available
├── Regression suite from graduated tiers runs on every beta
└── Lab shifts focus from "finding bugs" to "perfecting docs"

Harper v5.0.0 (release)
├── All graduated tiers run as regression suite
├── Getting-started rewrite validated against release
├── Skills and CLAUDE.md are release-ready
├── Pitfall catalog is comprehensive
└── Lab enters maintenance mode for v5.0.x
```

### Tracking What's Blocked

Some experiments will be blocked by real platform issues, not doc gaps.
The ledger needs to track this:

```yaml
experiment:
  status: "blocked"
  blocked_by:
    type: "platform_bug"
    issue: "https://github.com/HarperDB/harper/issues/123"
    description: "POST returns 500 on valid payload"
    workaround: null               # No workaround — genuinely blocked
    will_retry_on: "5.0.0-alpha.4" # When fix is expected
```

This prevents wasting compute re-running experiments that can't succeed yet,
and creates a queue of "retry these when the fix lands."

### The Regression Contract

Once a tier graduates on a specific Harper version, it becomes a regression test:

```
Tier 1 graduated on v5.0.0-alpha.3
├── From now on, every new Harper version runs Tier 1 with 2 workers
├── If pass rate drops below threshold → regression alert
├── Regression alert triggers:
│   1. Was this an intentional API change? → Update docs + skills
│   2. Was this an unintentional break? → Bug report with lab data
│   3. Was this a doc change that broke things? → Revert or fix docs
└── Graduated tiers are never "done" — they're continuously validated
```

---

## Handling API Design Feedback

This is the lab's most politically sensitive output. Telling a platform team
"your API design is unintuitive" needs data, not opinion.

### The Signal

When 3 out of 3 fresh agents independently try the same wrong approach, that's
a pattern worth reporting. It means the API violated a reasonable expectation
that developers carry from other platforms.

```yaml
api_design_observation:
  pattern: "batch_insert"
  frequency: "5/5 workers across 2 cohorts"
  what_devs_tried:
    - "POST /Table/ with body: [{...}, {...}, {...}]"
    - "POST /Table/batch with body: [{...}, {...}]"
    - "for (const item of items) { POST /Table/ ... }" # eventual workaround
  what_harper_supports: "Single-record POST only"
  developer_expectation: "Most REST APIs and databases support batch operations"
  time_cost: "avg 8 min to discover and work around"
  notes: "This is not a doc gap — documenting 'no batch insert' doesn't help.
          Developers expect this to exist. The question is whether Harper
          should support it."
```

### How to Report

API design observations are reported separately from doc patches, with data
but no prescriptive recommendation:

```markdown
## API Design Observation: Batch Insert

**Data:** 5/5 fresh agents across 2 cohorts independently attempted batch
insert before discovering it's not supported.

**What they tried:** POST with array body, POST to /batch endpoint, loop
with individual POSTs (the eventual workaround).

**Time cost:** Average 8 minutes to discover and work around per agent.

**Context:** Batch insert is standard in MongoDB (insertMany), PostgreSQL
(multi-row INSERT), Elasticsearch (bulk API), and most REST APIs.

**Not recommending a specific solution** — this is data for the Harper team
to consider. Options might include: supporting array POST bodies, adding a
/batch endpoint, documenting the single-record pattern prominently, or
deciding this is intentional and explaining why.
```

The lab provides the signal. The Harper team makes the decision. The lab
then tests whether the decision (whatever it is) works for fresh developers.

---

## Plugin Ecosystem

Harper plugins extend the platform's capabilities. The lab can serve the
plugin ecosystem in two distinct ways.

### Using Plugins (as a consumer)

Plugins are just another Harper feature that fresh agents need to discover,
install, and use correctly. They fit naturally into the tier system:

```yaml
project_types:
  # Test using a specific plugin
  - id: plugin-auth-jwt
    tier: 3
    assignment_file: auth-with-jwt-plugin.md
    features_tested: [plugins, jwt, authentication, middleware]
    requires_plugin: "harper-plugin-jwt"
    plugin_version: "1.0.0"
    tags: [plugin, auth, consumer]
    pass_criteria_file: plugin-auth-pass.sh

  # Test discovering and choosing plugins
  - id: plugin-discovery
    tier: 2
    assignment_file: build-app-with-plugins.md
    features_tested: [plugin_registry, plugin_install, plugin_config]
    tags: [plugin, discovery, consumer]
    notes: "Assignment mentions a need (e.g., auth) but doesn't name a plugin.
            SWE must discover available plugins, choose one, install, configure."
```

**Plugin consumer experiments reveal:**
- Can a fresh developer find available plugins?
- Are plugin installation docs clear?
- Do plugin configurations conflict with base Harper?
- Are plugin error messages helpful?
- Does the plugin's own documentation match Harper's patterns?

### Developing Plugins (as a creator)

This is a higher-tier challenge — can a fresh developer create a Harper plugin?
The lab tests the plugin authoring experience:

```yaml
project_types:
  - id: plugin-author-basic
    tier: 4
    assignment_file: create-rate-limit-plugin.md
    features_tested: [plugin_api, middleware, hooks, packaging]
    tags: [plugin, author, creator]
    pass_criteria:
      - Plugin loads in Harper without errors
      - Plugin exposes configuration via standard mechanism
      - Plugin can be installed by a fresh SWE using only the plugin's README
      - Rate limiting actually works

  - id: plugin-author-data
    tier: 5
    assignment_file: create-analytics-plugin.md
    features_tested: [plugin_api, tables, relationships, background_jobs]
    tags: [plugin, author, creator, advanced]
    pass_criteria:
      - Plugin creates its own tables
      - Plugin doesn't interfere with application tables
      - Plugin's data is queryable via standard REST API
```

**Plugin authoring experiments reveal:**
- Is the plugin API well-documented?
- Are hooks and lifecycle events discoverable?
- Can a plugin be tested in isolation?
- What's the minimum viable plugin structure?
- Are plugin packaging and distribution intuitive?

### Plugin Quality Loop

The lab creates a feedback loop between plugin authors and consumers:

```
Plugin Author Experiment
├── Fresh SWE creates a plugin
├── Expert reviews: is the plugin well-structured?
├── Output: the plugin itself + its README

Plugin Consumer Experiment (using the lab-created plugin)
├── Different fresh SWE tries to USE the plugin
├── Expert reviews: could the consumer install and use it?
├── Output: feedback on the plugin's README and DX

Feed consumer feedback back to the plugin author experiment
├── "Your README said X but I needed Y"
├── Improve plugin authoring skills to produce better READMEs
└── Eventually: plugin authoring produces consumer-tested plugins
```

---

## Adapting to Breaking Changes

Alpha software breaks things. The lab needs to handle this without losing
accumulated progress.

### When Harper Changes an API

```
Scenario: Harper v5.0.0-alpha.4 changes the REST query syntax
          from ?field=value to ?where=field:value

Impact:
├── All skills referencing old syntax are now wrong
├── All doc patches referencing old syntax are now wrong
├── Expert knowledge includes old syntax
├── Graduated tiers may fail on new syntax
└── Fresh SWEs reading OLD docs will use old syntax and fail

Lab response:
├── 1. Detect: regression suite catches the break
├── 2. Scope: which tiers, skills, patches, expert knowledge are affected?
├── 3. Update: revise skills, patches, expert knowledge for new syntax
│   (this is a fast operation — the lab has accumulated knowledge about
│    WHERE the syntax is used, so updates are targeted)
├── 4. Re-run: verify affected tiers pass with updated knowledge
├── 5. Track: log the breaking change in a changelog
│   └── This changelog itself becomes valuable — it documents
│       what changed and what developers need to update
└── 6. Bonus: the EASE of this update is a signal about API stability.
    If every alpha breaks 5 skills, the API isn't stable enough to
    graduate any tiers yet.
```

### Version-Conditional Expert Knowledge

The expert needs to handle version differences:

```markdown
# expert-knowledge/current/pitfalls.md

## REST Query Syntax
- **v5.0.0-alpha.1 through alpha.3**: `GET /Table/?field=value`
- **v5.0.0-alpha.4+**: `GET /Table/?where=field:value`
- If SWE uses old syntax and gets 400 error, hint: "Query syntax
  changed in alpha.4. Use ?where=field:value instead of ?field=value."
```

This versioned knowledge is valuable beyond the lab — it becomes the
migration guide for developers updating between versions.

### Stability Score

The lab can produce a stability score per feature area:

```
Feature: REST Query API
├── Syntax changed: 2 times across 4 alpha releases
├── Skills updated: 2 times
├── Breaking change severity: HIGH (every query affected)
├── Stability score: LOW — not ready for tier graduation
└── Recommendation: wait for beta before graduating tiers that depend
    on REST query syntax

Feature: Schema Definitions
├── Syntax changed: 0 times across 4 alpha releases
├── Skills updated: 0 times
├── Stability score: HIGH — stable enough to graduate
└── Recommendation: safe to graduate schema-dependent tiers
```

This helps you decide which tiers to invest in graduating vs which to
wait on. No point perfecting Tier 4 skills if the MQTT API is still
being redesigned.

---

## Open Source Community Value

All of this is especially valuable for open source because:

1. **Contributors can run the lab themselves.** The Docker-based setup means
   anyone with a laptop can run Tier 1 and get the same experience. This
   lowers the barrier to contributing doc fixes.

2. **Bug reports from the lab are high-quality.** Exact reproduction steps,
   exact environment, exact error. No "sometimes it breaks" — the lab
   produces deterministic reproductions.

3. **API design feedback is data-driven.** "5 out of 5 fresh developers
   expected batch insert" is more compelling in an open source discussion
   than "I think we should add batch insert."

4. **Plugin ecosystem quality.** Community plugins can be tested in the lab
   just like core features. "This plugin's README passes the lab" is a
   quality signal for the plugin registry.

5. **Version migration guides write themselves.** The lab's versioned
   knowledge, breaking change logs, and syntax migration notes are
   exactly what the changelog should contain.
