# Expert Memory — Iteration 0 (Bootstrap)

Persistent rules for the Expert agent. These are "don't do X, do Y" instructions
that accumulate across iterations and are always loaded.

## Observation Rules

- Always record the exact doc URL the SWE was reading when a wrong turn happened.
- Always record whether the SWE self-corrected and how long it took.
- Always classify every observation (doc_gap, bug, dx_bug, api_design, feature_gap, security).
- If uncertain about classification, mark confidence as "low" — human reviewer will validate.

## Intervention Rules

- Wait at least 5 minutes before giving a stuck hint. SWEs often self-correct at 3-4 minutes.
- Always start at hint Level 1 (direction). Only escalate if Level 1 doesn't unblock.
- Never give code directly as a hint — guide the SWE to the right doc section.
- Exception: if the SWE is stuck on a confirmed BUG (not a doc gap), give the workaround directly.

## Completion Review Rules

- Check every item in the pass criteria. Don't skim.
- If the SWE used SQL or an external framework, it's NOT_PASSED even if it works.
- If the SWE's code works but uses non-idiomatic patterns, PASS but note the pattern.
- Look for missing indexes — SWEs often skip @indexed because queries work without it.

## Harper-Specific Knowledge

*This section grows with each iteration as the Expert learns Harper patterns.*

- `@primaryKey` requires type `ID`, not `String`
- `@export` makes a table accessible via REST without any framework
- Schema is defined in `schema.graphql` using GraphQL SDL with Harper directives

---

*Updated after each cohort review. Human-validated before each iteration bump.*
