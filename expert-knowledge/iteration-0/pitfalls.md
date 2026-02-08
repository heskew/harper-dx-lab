# Expert Pitfalls — Iteration 0 (Bootstrap)

This file will be populated by observations from DX Lab experiments.
Each entry maps a common wrong turn to the correct Harper pattern.

## Format

```
### <Pitfall Title>
- **Agent tried:** <what the agent did>
- **Correct approach:** <what they should have done>
- **Why it happens:** <what misleads them>
- **Doc fix:** <what should change in the docs>
- **Frequency:** <how often this occurs>
- **Tiers affected:** <which tiers>
```

## Known Pitfalls (pre-lab)

### SQL Instead of REST
- **Agent tried:** Writing SQL queries (`SELECT * FROM bookmarks WHERE ...`)
- **Correct approach:** REST API (`GET /Bookmark/?tags=cooking`)
- **Why it happens:** Most database docs show SQL. Harper's REST-first model is unfamiliar.
- **Doc fix:** Getting-started should establish REST-first pattern before anything else.
- **Frequency:** Expected in nearly all Tier 1 first attempts.
- **Tiers affected:** 1, 2

### Express/Fastify as HTTP Layer
- **Agent tried:** `npm install express` to serve HTTP endpoints
- **Correct approach:** `@export` directive in schema makes tables directly accessible via REST
- **Why it happens:** Building a REST API normally requires a framework. Harper IS the framework.
- **Doc fix:** Emphasize "no framework needed" in getting-started.
- **Frequency:** Expected in most Tier 1 first attempts.
- **Tiers affected:** 1, 3

---

*This file grows with each expert iteration. After a cohort run, new pitfalls
are added from observation data and validated by human review.*
