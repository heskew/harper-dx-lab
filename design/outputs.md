## Outputs

Every tier produces concrete deliverables. These accumulate into a comprehensive
Harper developer toolkit.

### 1. Doc Patches
Format: Markdown diffs or PRs against https://github.com/HarperFast/documentation

Examples of what these look like:
- "Add example of `@relationship(from: fk)` with `select()` showing nested response"
- "Clarify that `@indexed` is required on FK fields for relationship queries to work"
- "Add troubleshooting section: common errors when extending Resource classes"
- "Add MQTT configuration example to harperdb-config.yaml reference"

### 2. AI Skills (for Claude Code / Claude Projects)
Format: SKILL.md files following Anthropic's skill spec

Produced iteratively as tiers are graduated:

```
harper-skills/
├── harper-crud/
│   ├── SKILL.md              # Tier 1: schema + REST basics
│   └── references/
│       ├── schema-patterns.md
│       └── rest-query-cheatsheet.md
├── harper-relationships/
│   ├── SKILL.md              # Tier 2: relationships + join queries
│   └── references/
│       ├── relationship-patterns.md
│       └── common-pitfalls.md
├── harper-resources/
│   ├── SKILL.md              # Tier 3: custom JS endpoints
│   └── references/
│       ├── resource-class-api.md
│       └── multi-table-patterns.md
├── harper-realtime/
│   ├── SKILL.md              # Tier 4: MQTT + WebSocket
│   └── references/
│       ├── mqtt-patterns.md
│       └── config-reference.md
├── harper-vector/
│   ├── SKILL.md              # Tier 5: vector search + AI
│   └── references/
│       └── hnsw-guide.md
└── harper-full-app/
    ├── SKILL.md              # Tier 6: integrated app patterns
    ├── references/
    │   ├── architecture-guide.md
    │   └── anti-patterns.md
    └── assets/
        └── app-template/     # Starter template with schema, resources, frontend
```

Each skill is validated by the tier that produced it — if Tier 2 agents pass
using the Tier 2 skill, the skill works. If they don't, the skill needs fixing.

### 3. CLAUDE.md Templates
Format: Project-level context files for Harper apps

```
harper-claude-md/
├── basic-crud.CLAUDE.md         # For simple CRUD apps
├── relational-app.CLAUDE.md     # For apps with relationships
├── realtime-app.CLAUDE.md       # For apps with MQTT/WebSocket
├── full-stack.CLAUDE.md         # For complete apps (like FlowSense)
└── sections/                    # Composable sections
    ├── harper-basics.md
    ├── schema-conventions.md
    ├── rest-api-reference.md
    ├── mqtt-patterns.md
    ├── resource-class-guide.md
    └── anti-mock-data-rule.md
```

### 4. Memory Files
Format: Persistent context for AI assistants

- Common Harper patterns and when to use them
- "Don't do X, do Y instead" rules learned from agent failures
- Schema design best practices
- Performance tips (when to use @indexed, cache patterns)

### 5. Pitfall Catalog
Format: Searchable catalog of "if you're trying X, you probably want Y"

Built directly from agent hallucinations:

| Agent tried | They probably wanted | Doc fix |
|---|---|---|
| `db.query("SELECT * FROM Shipment")` | `GET /Shipment/` or `tables.Shipment.search()` | Add "Harper doesn't use SQL" callout in getting started |
| `const express = require('express')` | Extend the Resource class | Add "you don't need Express" section in Resources doc |
| `npm install mqtt` for broker | Harper's built-in MQTT | Add "MQTT is built-in" callout in real-time docs |
| `JSON.parse(record.relationships)` | `@relationship` directive | Add relationship response example showing auto-resolution |
| `new WebSocket('ws://localhost:...')` | `connect(incomingMessages)` on resource | Add WebSocket example in real-time docs |

### 6. Getting Started Rewrite
Format: Complete tutorial sequence validated by agent pass rates

The ultimate output — a getting-started guide where every step has been
tested by multiple fresh agents and proven to work without prior knowledge.

---

