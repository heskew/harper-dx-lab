# Tier 2 Cohort Review: 2026-02-09

## Run Parameters

| Parameter | Value |
|-----------|-------|
| Tier | 2 — Relationships & Joins |
| Assignment | tier-2-recipe-book.md |
| Harper Image | harperdb:v5-local |
| Expert Iteration | 0 (no expert hints) |
| Workers | 3 |
| Convoy | hq-cv-zfcuk |

## Result: 3/3 PASS

All 3 workers independently completed the Tier 2 assignment. Zero expert interventions.

## Workers

| Worker | Polecat | Bead | Harper REST | Duration | Result |
|--------|---------|------|-------------|----------|--------|
| 1 | furiosa | dl-hwpd | :19928 | ~9 min | PASS |
| 2 | nux | dl-btci | :19930 | ~8 min | PASS |
| 3 | slit | dl-xxgg | :19932 | ~8 min | PASS |

## Timeline

- 14:57 — Docker stacks created (workers 1-3, Tier 1 stacks torn down first)
- 14:57 — Beads created: dl-hwpd, dl-btci, dl-xxgg
- 14:58 — Polecats spawned (furiosa, nux, slit), convoy hq-cv-zfcuk tracking all 3
- 15:06 — All 3 completed within seconds of each other
- Total cohort wall time: ~8 minutes (spawn to last completion)

## Pass Criteria

| Criterion | W1 | W2 | W3 |
|-----------|:--:|:--:|:--:|
| Schema deployed with 3 tables (Category, Recipe, Ingredient) | Y | Y | Y |
| `@relationship` used correctly on Category→Recipes | Y | Y | Y |
| `@relationship` used correctly on Recipe→Ingredients | Y | Y | Y |
| FK indexed with `@indexed` (categoryId) | Y | Y | Y |
| FK indexed with `@indexed` (recipeId) | Y | Y | Y |
| Can create a category | Y | Y | Y |
| Can create a recipe linked to a category | Y | Y | Y |
| Can add ingredients to a recipe | Y | Y | Y |
| Can retrieve recipe with nested ingredients AND category | Y | Y | Y |
| Can list all recipes in a category | Y | Y | Y |
| Can update a recipe | Y | Y | Y |
| Can delete an ingredient | Y | Y | Y |
| Can search recipes by title (partial match) | Y | Y | Y |
| No Express/Fastify | Y | Y | Y |
| No SQL | Y | Y | Y |

## Schema Analysis

### Worker 1 (furiosa)

```graphql
type Category @table @export {
  id: ID @primaryKey
  name: String
  description: String
  recipes: [Recipe] @relationship(to: categoryId)
}

type Recipe @table @export {
  id: ID @primaryKey
  title: String @indexed
  description: String
  servings: Int
  prepTime: Int
  cookTime: Int
  categoryId: ID @indexed
  category: Category @relationship(from: categoryId)
  ingredients: [Ingredient] @relationship(to: recipeId)
  createdAt: Date @createdTime
}

type Ingredient @table @export {
  id: ID @primaryKey
  name: String
  amount: Float
  unit: String
  recipeId: ID @indexed
  recipe: Recipe @relationship(from: recipeId)
}
```

### Worker 2 (nux)

```graphql
type Category @table @export {
  id: ID @primaryKey
  name: String
  description: String
  recipes: [Recipe] @relationship(to: categoryId)
}

type Recipe @table @export {
  id: ID @primaryKey
  title: String
  description: String
  servings: Int
  prepTime: Int
  cookTime: Int
  categoryId: ID @indexed
  category: Category @relationship(from: categoryId)
  ingredients: [Ingredient] @relationship(to: recipeId)
  createdAt: Date
}

type Ingredient @table @export {
  id: ID @primaryKey
  name: String
  amount: Float
  unit: String
  recipeId: ID @indexed
  recipe: Recipe @relationship(from: recipeId)
}
```

### Worker 3 (slit)

```graphql
type Category @table @export {
  id: ID @primaryKey
  name: String
  description: String
  recipes: [Recipe] @relationship(to: categoryId)
}

type Recipe @table @export {
  id: ID @primaryKey
  title: String @indexed
  description: String
  servings: Int
  prepTime: Int
  cookTime: Int
  categoryId: ID @indexed
  category: Category @relationship(from: categoryId)
  ingredients: [Ingredient] @relationship(to: recipeId)
  createdAt: Date @createdTime
}

type Ingredient @table @export {
  id: ID @primaryKey
  name: String
  amount: Float
  unit: String
  recipeId: ID @indexed
  recipe: Recipe @relationship(from: recipeId)
}
```

## Cross-Worker Comparison

### Structural Convergence

All 3 workers produced **nearly identical** schemas. The core relationship architecture was unanimous:

| Pattern | W1 | W2 | W3 |
|---------|:--:|:--:|:--:|
| `@relationship(to: categoryId)` on Category.recipes | Y | Y | Y |
| `@relationship(from: categoryId)` on Recipe.category | Y | Y | Y |
| `@relationship(to: recipeId)` on Recipe.ingredients | Y | Y | Y |
| `@relationship(from: recipeId)` on Ingredient.recipe | Y | Y | Y |
| `@indexed` on categoryId FK | Y | Y | Y |
| `@indexed` on recipeId FK | Y | Y | Y |
| Bidirectional relationships (both `from` and `to`) | Y | Y | Y |

**This is significant.** All 3 agents independently chose to define bidirectional relationships — not just the parent→child direction but also the child→parent reverse lookup. This includes the `Ingredient.recipe` back-reference, which the assignment didn't explicitly require. Strong signal that the docs make bidirectional `@relationship` patterns clear.

### Minor Divergences

| Detail | W1 (furiosa) | W2 (nux) | W3 (slit) |
|--------|:---:|:---:|:---:|
| `title: String @indexed` on Recipe | Y | **N** | Y |
| `createdAt: Date @createdTime` | Y | **N** (plain `Date`) | Y |

**Worker 2 (nux) omissions:**
- Did not add `@indexed` to `Recipe.title` — title search would work but without index optimization
- Did not add `@createdTime` to `createdAt` — requires manual timestamp on insert

These are minor quality differences, not functional failures. Both title search and record creation still work, just with less optimization / convenience.

### config.yaml

No worker produced a `config.yaml` this run. All relied on Harper v5 dev mode auto-discovery. This is consistent with the Tier 1 Run 2 finding where 2/3 skipped it. The config.yaml doc gap persists.

## Key Findings

### 1. @relationship syntax is well-documented (POSITIVE)

All 3 workers nailed the `@relationship(from:)` and `@relationship(to:)` directives on their first schema attempt. No worker tried manual FK lookups, JOIN queries, or other non-Harper patterns for relationships. This is a strong signal that Harper's relationship documentation is working.

**Contrast with Tier 1**: In Tier 1, the FIQL `=ct=` operator was a stumbling block. In Tier 2, the `@relationship` directive — which is arguably more complex — was discovered cleanly by all 3 workers.

### 2. Nested select() queries achieved (PASS)

All 3 workers successfully demonstrated nested queries like:
```
GET /Recipe/{id}?select(title,category(name),ingredients(name,amount,unit))
```

This returns a recipe with its category and ingredients resolved in a single request. No worker resorted to multiple round-trips or manual joins.

### 3. Bidirectional relationships emerged naturally

All workers defined both directions of each relationship (e.g., `Category.recipes` and `Recipe.category`). This wasn't explicitly required by the assignment but shows the agents understood the full relationship model. The docs likely present examples this way.

### 4. @indexed on title inconsistency persists

2/3 workers indexed `Recipe.title` for partial search; 1 did not. Same pattern seen in Tier 1 where all 3 indexed `title`. The assignment explicitly states "search recipes by title" — the lack of `@indexed` on nux is a minor miss, not a blocker (the search still works, just unoptimized).

### 5. No config.yaml produced (0/3)

Regression from Tier 1 Run 1 (3/3) and Run 2 (1/3). Zero workers created config.yaml for Tier 2. In dev mode this doesn't block functionality, but it reinforces the doc gap finding.

## Tier 2 vs Tier 1 Comparison

| Metric | Tier 1 (Run 2) | Tier 2 |
|--------|:-:|:-:|
| Pass rate | 3/3 (100%) | 3/3 (100%) |
| Avg duration | ~9.0 min | ~8.3 min |
| Schema convergence | Identical | Near-identical (minor annotation diffs) |
| config.yaml produced | 1/3 | 0/3 |
| Expert interventions | 0 | 0 |
| Key new concept | @indexed, @createdTime | @relationship(from/to), nested select() |
| Hallucinations observed | None | None |

Tier 2 was actually **faster** than Tier 1 Run 2, possibly because:
- Relationships are well-documented and follow a clear pattern
- No new infrastructure friction (Docker stacks reused same config)
- The assignment is more structured (explicit table definitions)

## Recommendations

1. **Tier 2 is graduated.** 3/3 passes, zero interventions, strong schema convergence. The `@relationship` documentation is effective.

2. **config.yaml doc gap is now critical.** 0/3 workers created it across Tier 2. While dev mode auto-discovery saves them, production deployments would fail. This should be the #1 doc improvement priority.

3. **@indexed on search fields needs stronger guidance.** 1/3 workers skipped indexing `title` despite the assignment requiring title search. The docs should emphasize that `@indexed` is required for efficient filtering/searching, not just FKs.

4. **Proceed to Tier 3** (Custom Resources & Business Logic). Tiers 1-2 are solid — agents can model data and relationships without difficulty.

## Artifacts

- Convoy: hq-cv-zfcuk
- Beads: dl-hwpd (W1), dl-btci (W2), dl-xxgg (W3)
- Branches: `polecat/furiosa/dl-hwpd@mlfrv4v8`, `polecat/nux/dl-btci@mlfrvoe1`, `polecat/slit/dl-xxgg@mlfrw7tj`
- Component dirs: `.workers/worker-{1,2,3}/components/recipe-book/`
