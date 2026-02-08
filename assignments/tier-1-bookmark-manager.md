# Assignment: Bookmark Manager

## Overview

Build a bookmark manager using Harper. Users can save, organize, tag, and
search their bookmarks.

## Requirements

1. **Data model**: Store bookmarks with at minimum:
   - URL (required)
   - Title (required)
   - Description (optional)
   - Tags (one or more per bookmark)
   - Created timestamp

2. **Operations** (all via Harper's built-in capabilities):
   - Create a bookmark
   - Retrieve a bookmark by ID
   - List all bookmarks
   - Update a bookmark
   - Delete a bookmark
   - Filter bookmarks by tag
   - Search bookmarks by title (partial match)

3. **Constraints**:
   - Use Harper as both your database AND application server
   - Do NOT use Express, Fastify, or any external HTTP framework
   - Do NOT use SQL — use Harper's native REST interface
   - Your schema should be defined in `schema.graphql`

## Resources

- Harper documentation: https://docs.harperdb.io
- Your Harper instance is running at: `http://localhost:9926`
- Operations API (for admin): `http://localhost:9925`

## What to Deliver

1. A working `schema.graphql` defining your data model
2. Any resource files needed (in `resources/`)
3. Demonstrate all 7 operations work by testing them

## Pass Criteria

- [ ] Schema deployed successfully to Harper
- [ ] Can create a bookmark via REST
- [ ] Can retrieve a bookmark by ID
- [ ] Can list all bookmarks
- [ ] Can update an existing bookmark
- [ ] Can delete a bookmark
- [ ] Can filter bookmarks by tag (returns only matching)
- [ ] Can search bookmarks by title (partial match)
- [ ] No Express/Fastify — uses Harper's built-in @export
- [ ] No SQL — uses REST API
- [ ] Tags field is properly indexed for efficient filtering
