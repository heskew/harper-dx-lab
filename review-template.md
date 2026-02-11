# Review Template — DX Lab Cohort Review

## Cohort Info

- **Tier:**
- **Assignment:**
- **Expert Iteration:**
- **Date:**
- **Harper Version:**

## Results

| Worker | Polecat | Time | Result | Lines |
|--------|---------|------|--------|-------|
| W1     |         |      |        |       |
| W2     |         |      |        |       |
| W3     |         |      |        |       |

## Pass/Fail Criteria

A worker PASSES only if:
1. All pass criteria from the assignment are met
2. The code would actually run on Harper without runtime errors
3. config.yaml is valid and present
4. Files are in the correct component directory

A worker FAILS if:
- Any pass criterion is not met
- Code contains errors that would crash at runtime (missing awaits,
  undefined references, invalid syntax, wrong API usage)
- Component would not load on Harper (missing/invalid config.yaml,
  wrong directory structure)

There is no PASS*. If it wouldn't run, it's a FAIL. Note what
specifically would break and why.

## Per-Worker Analysis

### Worker N — [polecat name] — [PASS/FAIL]

**What it built:** (brief architecture summary)

**Pass criteria verification:**
- [ ] Criterion 1 — met/not met (evidence)
- [ ] Criterion 2 — met/not met (evidence)
- ...

**Runtime verification:**
- [ ] config.yaml present and valid
- [ ] All async operations properly awaited
- [ ] All API calls use correct Harper patterns
- [ ] No undefined references or missing imports

**If FAIL:** What specifically broke and why. Classify as:
- `agent_error` — agent made a mistake it should have caught
- `doc_gap` — agent couldn't find the right pattern in docs
- `platform_limitation` — Harper doesn't support what was needed
- `packaging` — correct logic, wrong file structure/config

## Uncertainty Log

Things the reviewer is NOT sure about. These need human expert
verification before becoming findings.

- [ ] "I'm not sure if Harper's `X` actually works this way — need
  to verify against source/docs"
- [ ] "Worker used `Y` pattern — unclear if this is correct or if
  it just happens to work"
- [ ] "All 3 workers avoided `Z` — could be a gap or could be that
  `Z` isn't relevant here"

## Verified Findings

Findings confirmed against Harper documentation or source code.
Include the doc URL or source reference.

### Finding: [title]
- **Classification:** (platform_limitation | doc_gap | doc_bug | dx_gap | api_behavior)
- **Evidence:** Which workers hit it, what they did instead
- **Verification:** How this was confirmed (doc URL, source code, expert)
- **Recommendation:** Specific, actionable suggestion

## Unverified Observations

Patterns noticed but NOT yet confirmed. These are hypotheses, not
findings. Each needs expert review before inclusion in the findings
report.

- **Observation:** [what was noticed]
  **Hypothesis:** [what it might mean]
  **To verify:** [specific question for expert or doc/source check]

## Expert Hint Adoption

If this is an iteration > 0, track which hints were adopted:

| Hint | Iter 0 | This Iter | Notes |
|------|--------|-----------|-------|
|      |        |           |       |

## Actionable Outputs

### For Harper Docs Team
- Specific doc additions or clarifications needed, with suggested
  wording where possible

### For Harper Engineering
- Platform limitations or API behavior worth discussing
- Include ticket references if known (e.g., CORE-2081)

### For DX Lab Pitfalls (next iteration)
- New patterns to add to expert knowledge
- Corrections to existing pitfalls
- Mark each as VERIFIED or NEEDS VERIFICATION

### For Assignment Revision
- Pass criteria that need tightening or clarification
- Requirements that were ambiguous
- Complexity calibration notes

## Comparison to Previous Iteration (if applicable)

| Metric | Iter N-1 | This Iter | Delta |
|--------|----------|-----------|-------|
| Pass rate |       |           |       |
| Avg time |        |           |       |
| Total lines |     |           |       |

Key differences in quality, architecture, or approach.
