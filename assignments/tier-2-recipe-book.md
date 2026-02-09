# Assignment: Recipe Book

## Overview

Build a recipe book API using Harper. Recipes belong to categories and have
ingredients. This assignment tests relationships between tables, nested
queries, and foreign key indexing.

## Requirements

1. **Data model**: Three related tables:

   **Category**
   - Name (required)
   - Description (optional)
   - Recipes (relationship — all recipes in this category)

   **Recipe**
   - Title (required)
   - Description (optional)
   - Servings (integer)
   - Prep time in minutes (integer)
   - Cook time in minutes (integer)
   - Category reference (foreign key)
   - Ingredients (relationship — all ingredients for this recipe)
   - Created timestamp

   **Ingredient**
   - Name (required)
   - Amount (number)
   - Unit (string, e.g. "cups", "tbsp", "grams")
   - Recipe reference (foreign key)

2. **Relationships**:
   - A Recipe belongs to one Category (many-to-one)
   - A Category has many Recipes (one-to-many)
   - A Recipe has many Ingredients (one-to-many)
   - An Ingredient belongs to one Recipe (many-to-one)

3. **Operations** (all via Harper's built-in capabilities):
   - Create a category
   - Create a recipe in a category
   - Add ingredients to a recipe
   - Retrieve a recipe by ID **with nested ingredients and category**
   - List all recipes in a specific category (via relationship or filter)
   - Update a recipe (e.g. change servings or prep time)
   - Delete an ingredient from a recipe
   - Search recipes by title (partial match)

4. **Constraints**:
   - Use Harper as both your database AND application server
   - Do NOT use Express, Fastify, or any external HTTP framework
   - Do NOT use SQL — use Harper's native REST interface
   - Your schema should be defined in `schema.graphql`
   - Foreign keys MUST be indexed with `@indexed`
   - Use `@relationship` directive to define table relationships

## Resources

- Harper documentation: https://docs.harperdb.io
- Your Harper instance is running at: `http://localhost:9926`
- Operations API (for admin): `http://localhost:9925`
- Auth credentials: `admin` / `password`

## What to Deliver

1. A working `schema.graphql` with three tables and proper relationships
2. Any resource files needed (in `resources/`)
3. Demonstrate all 8 operations work by testing them
4. At least one nested query that returns a recipe with its ingredients and category in a single request

## Pass Criteria

- [ ] Schema deployed with three tables (Category, Recipe, Ingredient)
- [ ] `@relationship` used correctly on Category→Recipes and Recipe→Ingredients
- [ ] Foreign keys indexed with `@indexed` (categoryId, recipeId)
- [ ] Can create a category
- [ ] Can create a recipe linked to a category
- [ ] Can add ingredients to a recipe
- [ ] Can retrieve a recipe with nested ingredients AND category in one request
- [ ] Can list all recipes in a category
- [ ] Can update a recipe
- [ ] Can delete an ingredient
- [ ] Can search recipes by title (partial match)
- [ ] No Express/Fastify — uses Harper's built-in @export
- [ ] No SQL — uses REST API
