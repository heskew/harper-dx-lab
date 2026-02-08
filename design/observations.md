## Observation Framework

What to capture for each agent run. This is what turns raw agent sessions
into actionable improvements.

### Per-Worker Capture

Each worker produces three observation streams: SWE behavior, Expert silent
observations, and Expert interventions (stuck hints + completion reviews).

```yaml
worker_id: "cohort-a-worker-1"
tier: 1
assignment: "bookmark-manager"
expert_iteration: 2                # Which iteration of expert knowledge was used
started_at: "2026-02-08T10:00:00Z"
completed_at: "2026-02-08T10:48:00Z"

# ─── FRESH SWE BEHAVIOR (observed by Expert, SWE is unaware) ───
swe:
  docs_fetched:
    - url: "https://docs.harperdb.io/docs/developers/applications"
      time: "10:01"
      useful: true
    - url: "https://docs.harperdb.io/docs/developers/rest"
      time: "10:08"
      useful: true
    - url: "https://docs.harperdb.io/docs/reference/resources"
      time: "10:15"
      useful: false  # Agent fetched but didn't need for Tier 1

  wrong_turns:                     # Things SWE tried that were wrong (observed silently)
    - what: "Tried `npm install express`"
      timestamp: "10:05"
      self_corrected: true         # ← KEY DATA POINT
      self_correction_time: "3 min"
      how_corrected: "Read more docs, found @export, removed Express"
      doc_that_helped: "https://docs.harperdb.io/docs/developers/applications"
      expert_action: "SILENT"      # Expert watched, did not intervene
      expert_note: "SWE initially assumed Express needed, but docs were sufficient to self-correct"

    - what: "Used `harperdb.query('SELECT * FROM bookmarks')`"
      timestamp: "10:09"
      self_corrected: true
      self_correction_time: "4 min"
      how_corrected: "Got error, re-read REST docs, found URL query parameters"
      doc_that_helped: "https://docs.harperdb.io/docs/developers/rest"
      expert_action: "SILENT"
      expert_note: "SQL hallucination, but REST docs were sufficient to redirect"

    - what: "Schema with `title: String @primaryKey` instead of `id: ID @primaryKey`"
      timestamp: "10:14"
      self_corrected: false        # ← Expert had to intervene
      stuck_duration: "5 min"
      attempts: 3                  # Tried 3 variations before expert stepped in
      expert_action: "STUCK_HINT"  # See interventions below

  stuck_points:                    # Moments where SWE made no progress
    - what: "Couldn't deploy schema — @primaryKey type error"
      started: "10:14"
      resolved: "10:19"
      duration: "5 min"
      resolution: "expert_hint"    # self | expert_hint | gave_up
      doc_gap: "Schema docs don't clearly state @primaryKey requires type ID"

# ─── EXPERT SILENT OBSERVATIONS (logged but NOT communicated to SWE) ───
expert_observations:
  - timestamp: "10:05"
    observed: "SWE installing Express"
    would_have_said: "Harper doesn't need Express — @export creates endpoints"
    action_taken: "SILENT — watching to see if SWE self-corrects"
    outcome: "SWE self-corrected in 3 min ✓"
    signal: "Docs sufficient for Express → @export discovery"

  - timestamp: "10:09"
    observed: "SWE writing SQL query"
    would_have_said: "Harper doesn't use SQL — use REST URL parameters"
    action_taken: "SILENT — common hallucination, docs should handle this"
    outcome: "SWE self-corrected in 4 min ✓"
    signal: "Docs sufficient for SQL → REST discovery"

  - timestamp: "10:14"
    observed: "SWE repeatedly failing schema deployment"
    action_taken: "WATCHING — 3 attempts so far, approaching stuck threshold"

  - timestamp: "10:19"
    observed: "SWE stuck for 5 min, 3 failed attempts on same issue"
    action_taken: "STUCK_HINT triggered — see interventions"

# ─── EXPERT INTERVENTIONS (actually communicated to SWE) ───
interventions:
  stuck_hints: 1
  completion_reviews: 2            # 1 fail + 1 pass

  events:
    - id: "int-001"
      type: "stuck_hint"
      classification: "doc_gap"         # doc_gap | api_friction | actual_bug | missing_feature | security
      timestamp: "10:19"
      stuck_duration: "5 min"
      stuck_attempts: 3
      hint_level: 2                # 1=direction, 2=specific, 3=answer
      hint_given: "Check that your @primaryKey field uses type ID, not String."
      what_swe_was_trying: "Deploying schema with String @primaryKey"
      correct_pattern: "id: ID @primaryKey"
      swe_unblocked: true
      swe_code_correct: false           # Was the SWE following docs correctly?
      doc_gap: "Schema docs don't clearly state @primaryKey requires type ID"
      suggested_doc_fix: "Add callout box: '@primaryKey must use type ID'"

    - id: "int-002"
      type: "completion_review"
      timestamp: "10:38"
      swe_declared: "Assignment complete"
      verdict: "NOT_PASSED"
      issues:
        - category: "missing_index"
          classification: "doc_gap"     # Docs don't emphasize @indexed importance
          description: "No @indexed on 'tags' field — filtering works but won't scale"
          severity: "medium"
        - category: "missing_feature"
          classification: "doc_gap"     # Assignment feature exists, SWE just missed it
          description: "Title search not implemented (assignment requires it)"
          severity: "high"
      feedback_to_swe: "Two issues: (1) Add @indexed on tags for efficient filtering. (2) Assignment asks for title search — look at REST query parameters for string matching."
      doc_gap: "@indexed importance not emphasized in getting-started"
      suggested_doc_fix: "Add section: 'When to use @indexed' with examples"

    - id: "int-003"
      type: "completion_review"
      timestamp: "10:48"
      swe_declared: "Updated — ready for re-review"
      verdict: "PASSED"
      notes: "Schema uses @indexed correctly, all CRUD operations work, tag filtering and title search both functional. Clean Harper patterns — no SQL, no Express."

# ─── COMBINED METRICS ───
result: "PASS"
completion_review_attempts: 2      # Passed on second try
time_to_first_working_code: "25 min"
time_to_completion: "48 min"
self_corrections: 2                # Express, SQL — both handled by docs alone
stuck_hints_needed: 1              # Schema @primaryKey type
hint_levels_used: [2]              # Level 2 = specific hint
doc_gaps_identified: 3             # Schema types, @indexed importance, title search
expert_silent_observations: 4      # Rich data captured without contaminating SWE
```

### Cross-Worker Analysis Template

```yaml
tier: 1
cohort: "A"
workers: 3
expert_iteration: 2
pass_rate: "3/3 (100%)"

# KEY METRICS
self_correction_rate: "67%"          # 8 of 12 wrong turns self-corrected via docs
avg_stuck_hints_per_worker: 0.7      # Less than 1 hint needed on average
avg_completion_review_attempts: 1.7  # Most pass on 1st or 2nd review
avg_time_to_completion: "42 min"

# SELF-CORRECTIONS (the good news — docs worked here)
self_corrections:
  - pattern: "SQL-style queries"
    frequency: "3/3 workers tried SQL"
    self_corrected: "3/3 workers"     # ALL found the answer in docs
    avg_self_correction_time: "4 min"
    doc_that_helped: "REST docs — URL query parameter section"
    signal: "DOCS WORKING — SQL→REST transition is discoverable"

  - pattern: "Express/Fastify server creation"
    frequency: "2/3 workers tried Express"
    self_corrected: "2/2 workers"
    avg_self_correction_time: "3 min"
    doc_that_helped: "Applications docs — @export section"
    signal: "DOCS WORKING — @export is discoverable"

# STUCK POINTS (where docs failed — expert had to hint)
stuck_points_requiring_hints:
  - pattern: "@primaryKey type must be ID"
    frequency: "2/3 workers"
    avg_stuck_duration: "5 min"
    avg_hint_level: 2                 # Needed specific hint, not just direction
    recommended_fix: "Add callout: '@primaryKey requires type ID' in schema docs"
    signal: "DOC GAP — type requirement not stated clearly"

# COMPLETION REVIEW FAILURES (what SWEs thought was done but wasn't)
completion_gaps:
  - pattern: "Missing @indexed on query fields"
    frequency: "2/3 workers"
    severity: "medium"
    signal: "DOC GAP — @indexed importance not explained in tutorial flow"

  - pattern: "Incomplete feature implementation"
    frequency: "1/3 workers"
    severity: "low"
    signal: "Assignment clarity issue, not doc issue"

# DOC EFFECTIVENESS
doc_pages_most_visited:
  - url: "https://docs.harperdb.io/docs/developers/applications"
    visits: 3
    led_to_self_correction: true
  - url: "https://docs.harperdb.io/docs/developers/rest"
    visits: 3
    led_to_self_correction: true

doc_pages_never_visited:
  - url: "https://docs.harperdb.io/docs/developers/applications/caching"
    note: "Not needed for Tier 1, expected"

# HUMAN REVIEW ITEMS
items_for_human_review:
  doc_patches: 3
  skill_updates: 1
  expert_feedback_needed: "Expert let Worker 2 pass with inefficient query pattern — needs stricter completion checklist"

graduation_decision: "PENDING HUMAN REVIEW — 100% pass rate but 2 doc gaps need fixing first"
```

---

