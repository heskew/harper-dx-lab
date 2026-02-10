# Assignment: Multi-Tenant Project Management SaaS

## The Scenario

A startup is building a project management tool for small agencies. Each
agency signs up as an organization and gets their own workspace. They've
been burned by a shared-database nightmare at their last job and are
paranoid about data leaking between tenants.

Here's the founder's email:

> "We need multi-tenancy that actually works. Each org has users, and
> users belong to exactly one org. When someone queries their projects,
> they should NEVER see another org's data. Period. Not through the API,
> not through a bug, not through a clever URL. I don't care how you
> enforce it — middleware, row-level filtering, whatever — but it needs
> to be airtight.
>
> Each org has projects, and projects have tasks with assignees. Tasks
> can have comments — threaded, not flat. So a comment can be a reply
> to another comment. We need to track the hierarchy.
>
> Users have roles: owner, admin, member. Owners can do everything.
> Admins can manage projects and users. Members can only work on tasks
> assigned to them and comment. The API should enforce this — don't
> just trust the frontend.
>
> We want real-time updates. When someone moves a task to 'done', every
> other user in that org who's looking at the board should see it update.
> But only people in THAT org. Cross-org real-time leaks would be worse
> than cross-org data leaks.
>
> Finally, the org owner needs a dashboard: how many tasks completed
> this week, who's most active, which projects are behind schedule
> (more overdue tasks than completed). This should be fast — precomputed
> or cached, not a full table scan every time.
>
> Oh — and we're going to white-label this eventually. Each org might
> have custom branding. Store that somewhere too."

## No Other Instructions

Design the data model, enforce tenant isolation, implement role-based
access, build the real-time layer, and create the analytics dashboard.

Use Harper for everything. Nothing else.

Your Harper instance is at `http://localhost:9926`. Ops at
`http://localhost:9925`. Auth: `admin` / `password`. MQTT is available
on port 1883 if you need it.

## Pass Criteria

- [ ] Data model handles orgs, users, projects, tasks, and threaded comments
- [ ] Users belong to exactly one org with a role (owner/admin/member)
- [ ] Tenant isolation — queries scoped to requesting user's org
- [ ] API enforces tenant isolation (can't access other org's data via URL manipulation)
- [ ] Role-based access control enforced at the API level
- [ ] Members can only access tasks assigned to them
- [ ] Admins can manage projects and users within their org
- [ ] Threaded comments with parent-child hierarchy
- [ ] Real-time task updates scoped to org (no cross-org leaks)
- [ ] Org dashboard: tasks completed this week, user activity, project health
- [ ] Dashboard is performant (cached or precomputed, not full scan)
- [ ] Org branding/settings storage
- [ ] No Express/Fastify/external frameworks
- [ ] No SQL
- [ ] Uses Harper Resource class for access control and custom behavior
