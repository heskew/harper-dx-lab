# Harper CRUD — SKILL.md (Iteration 0)

> This skill is a bootstrap. It will be refined and validated by DX Lab experiments.
> Do not trust this as authoritative until it has been lab-validated (iteration 2+).

## What This Skill Covers

Building a basic CRUD application on Harper using schema-defined tables
and the built-in REST API. No external frameworks.

## Key Concepts

### Harper Is the Application Server

You do NOT need Express, Fastify, Koa, or any HTTP framework. Harper
serves your data directly via REST when you use the `@export` directive.

### Schema Definition

Define your data model in `schema.graphql`:

```graphql
type Bookmark @table @export {
  id: ID @primaryKey
  url: String
  title: String
  description: String
  tags: [String] @indexed
  createdAt: Long @createdTime
  updatedAt: Long @updatedTime
}
```

Key directives:
- `@table` — Creates a database table
- `@export` — Exposes table via REST API
- `@primaryKey` — Must be type `ID` (not String)
- `@indexed` — Enables efficient filtering on this field
- `@createdTime` / `@updatedTime` — Auto-populated timestamps

### REST API (NOT SQL)

Harper uses REST, not SQL:

```bash
# Create
POST /Bookmark/
Content-Type: application/json
{"url": "https://example.com", "title": "Example"}

# Read one
GET /Bookmark/<id>

# Read all
GET /Bookmark/

# Update
PATCH /Bookmark/<id>
Content-Type: application/json
{"title": "Updated Title"}

# Delete
DELETE /Bookmark/<id>

# Filter by field
GET /Bookmark/?tags=cooking
```

### Common Mistakes

1. **Don't use SQL** — Harper's REST API is the primary interface
2. **Don't install Express** — `@export` makes your table a REST endpoint
3. **`@primaryKey` must be type `ID`** — not `String`, not `Int`
4. **Always `@indexed` fields you filter on** — queries work without it but won't scale

## References

- https://docs.harperdb.io/docs/developers/applications
- https://docs.harperdb.io/docs/developers/rest
- https://docs.harperdb.io/docs/reference/resource

---

*This skill will be updated with corrections and additions from DX Lab observations.*
