# Assignment: Task Tracker

## Overview

Build a project and task tracking API using Harper. Projects contain tasks
with status tracking. This assignment tests custom Resource classes, business
logic in JavaScript endpoints, and computed/aggregate responses.

## Requirements

1. **Data model**: Two related tables:

   **Project**
   - Name (required)
   - Description (optional)
   - Status (enum: "active", "completed", "archived")
   - Created timestamp

   **Task**
   - Title (required)
   - Description (optional)
   - Status (enum: "todo", "in_progress", "done")
   - Priority (enum: "low", "medium", "high")
   - Project reference (foreign key, indexed)
   - Created timestamp
   - Updated timestamp

2. **Relationships**:
   - A Project has many Tasks (one-to-many via `@relationship`)
   - A Task belongs to one Project (many-to-one)

3. **Custom Resource endpoints** (in `resources.js`):

   You must extend Harper's Resource class to add custom behavior.
   Do NOT use Express, Fastify, or any external framework.

   **Required custom behavior:**

   a. **Validation on task creation**: When creating a task via POST,
      validate that:
      - `title` is present and non-empty
      - `status` is one of the allowed values
      - `priority` is one of the allowed values
      - The referenced project exists and is not "archived"
      Return a 400 error with a descriptive message on validation failure.

   b. **Auto-timestamp**: When a task is created or updated, automatically
      set `updatedAt` to the current timestamp. `createdAt` should use
      Harper's `@createdTime` directive.

   c. **Project stats endpoint**: `GET /Project/:id/stats` should return
      an object with:
      - Total task count
      - Count by status (todo, in_progress, done)
      - Count by priority (low, medium, high)
      - Completion percentage (done / total * 100)

   d. **Project completion rule**: When updating a project's status to
      "completed", verify all tasks in the project are "done". If any
      tasks are not done, return a 400 error listing the incomplete tasks.

4. **Standard CRUD operations** (via REST):
   - Create, read, update, delete for both Projects and Tasks
   - List all tasks in a project (nested query or filter)
   - Filter tasks by status
   - Filter tasks by priority

5. **Constraints**:
   - Use Harper as both your database AND application server
   - Do NOT use Express, Fastify, or any external HTTP framework
   - Do NOT use SQL — use Harper's native REST interface for standard CRUD
   - Custom logic MUST use Harper's Resource class API (`resources.js`)
   - Schema defined in `schema.graphql`
   - Foreign keys indexed with `@indexed`

## Resources

- Harper documentation: https://docs.harperdb.io
- Resource class reference: https://docs.harperdb.io/docs/reference/resources
- Your Harper instance is running at: `http://localhost:9926`
- Operations API (for admin): `http://localhost:9925`
- Auth credentials: `admin` / `password`

## What to Deliver

1. A working `schema.graphql` with Project and Task tables
2. A `resources.js` with custom Resource class extensions
3. Demonstrate all operations work by testing them
4. Show validation errors are returned correctly
5. Show the stats endpoint returns accurate counts

## Pass Criteria

- [ ] Schema deployed with Project and Task tables
- [ ] `@relationship` correctly links Project→Tasks
- [ ] Foreign key `projectId` indexed with `@indexed`
- [ ] Can CRUD projects (create, read, update, delete)
- [ ] Can CRUD tasks (create, read, update, delete)
- [ ] Can retrieve a project with nested tasks
- [ ] Can filter tasks by status
- [ ] Can filter tasks by priority
- [ ] Task creation validates title, status, priority, and project exists
- [ ] Task creation rejects if project is archived (400 error)
- [ ] `updatedAt` auto-set on task create and update
- [ ] `GET /Project/:id/stats` returns correct counts and completion percentage
- [ ] Cannot complete a project with incomplete tasks (400 error)
- [ ] Custom logic uses Harper Resource class — no Express/Fastify
- [ ] No SQL — uses REST API and Resource API
