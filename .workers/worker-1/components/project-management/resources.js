// Multi-Tenant Project Management SaaS
// Tenant isolation, RBAC, real-time updates, precomputed dashboard

const DASHBOARD_TTL = 5 * 60 * 1000; // 5 minutes
const dashboardCache = new Map(); // orgId -> { data, computedAt }

// ── Helpers ─────────────────────────────────────────────────────────

function getWeekStart(timestamp) {
  const d = new Date(timestamp);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

// ── Authentication & Tenant Isolation ───────────────────────────────

async function authenticate(resourceInstance) {
  const context = resourceInstance.getContext();
  const userId = context.headers.get('x-user-id');
  if (!userId) return null;
  const user = await tables.User.get(userId);
  if (!user || user.active === false) return null;
  return user;
}

async function tenantGate(resourceInstance, opts = {}) {
  const { requiredRoles = null } = opts;
  const user = await authenticate(resourceInstance);
  if (!user) {
    return { denied: true, response: { status: 401, headers: {}, data: { error: 'Unauthorized' } } };
  }
  if (requiredRoles && !requiredRoles.includes(user.role)) {
    return { denied: true, response: { status: 403, headers: {}, data: { error: 'Forbidden: insufficient role' } } };
  }
  return { denied: false, user, orgId: user.orgId };
}

function canAccessTask(user, task) {
  if (user.role === 'owner' || user.role === 'admin') return true;
  return task.assigneeId === user.id;
}

// ── Dashboard Computation (cached) ──────────────────────────────────

async function computeDashboard(orgId) {
  const cached = dashboardCache.get(orgId);
  if (cached && Date.now() - cached.computedAt < DASHBOARD_TTL) {
    return cached.data;
  }

  const now = Date.now();
  const weekStart = getWeekStart(now);

  let tasksCompletedThisWeek = 0;
  const userCounts = {}; // userId -> completions this week
  const projectStats = {}; // projectId -> { overdue, completed }

  for await (const task of await tables.Task.search({
    conditions: [{ attribute: 'orgId', value: orgId }],
  })) {
    const pid = task.projectId;
    if (!projectStats[pid]) projectStats[pid] = { overdue: 0, completed: 0 };

    if (task.status === 'done') {
      projectStats[pid].completed++;
      if (task.completedAt && task.completedAt >= weekStart) {
        tasksCompletedThisWeek++;
        if (task.assigneeId) {
          userCounts[task.assigneeId] = (userCounts[task.assigneeId] || 0) + 1;
        }
      }
    } else if (task.dueDate && task.dueDate < now) {
      projectStats[pid].overdue++;
    }
  }

  // Build project health
  const projectHealth = [];
  for (const [pid, stats] of Object.entries(projectStats)) {
    const project = await tables.Project.get(pid);
    projectHealth.push({
      projectId: pid,
      name: project ? project.name : 'Unknown',
      completedTasks: stats.completed,
      overdueTasks: stats.overdue,
      behindSchedule: stats.overdue > stats.completed,
    });
  }

  // Build user activity ranked list
  const userActivity = [];
  for (const [uid, count] of Object.entries(userCounts)) {
    const u = await tables.User.get(uid);
    userActivity.push({
      userId: uid,
      name: u ? u.name : 'Unknown',
      tasksCompleted: count,
    });
  }
  userActivity.sort((a, b) => b.tasksCompleted - a.tasksCompleted);

  const dashboard = {
    orgId,
    tasksCompletedThisWeek,
    userActivity,
    projectHealth,
    lastComputedAt: now,
  };

  // Cache in memory
  dashboardCache.set(orgId, { data: dashboard, computedAt: now });

  // Persist to table for durability
  try {
    await tables.OrgDashboard.put({
      id: orgId,
      orgId,
      tasksCompletedThisWeek,
      userActivity: JSON.stringify(userActivity),
      projectHealth: JSON.stringify(projectHealth),
      lastComputedAt: now,
    });
  } catch (e) { /* persistence is best-effort; in-memory cache is primary */ }

  return dashboard;
}

// ── Organization Resource ──────────────────────────────────────────

export class Organization extends tables.Organization {
  static loadAsInstance = false;

  async get(query) {
    const g = await tenantGate(this);
    if (g.denied) return g.response;

    if (query.id) {
      // Tenant isolation: can only view own org
      if (query.id !== g.orgId) {
        return { status: 403, headers: {}, data: { error: 'Access denied' } };
      }
      const org = await tables.Organization.get(query.id);
      if (!org) return { status: 404, headers: {}, data: { error: 'Organization not found' } };
      return org;
    }

    // List: return only the user's own org
    const org = await tables.Organization.get(g.orgId);
    return org ? [org] : [];
  }

  async post(target, data) {
    // Unauthenticated: registration creates an org
    return tables.Organization.post(data);
  }

  async patch(target, data) {
    const g = await tenantGate(this, { requiredRoles: ['owner'] });
    if (g.denied) return g.response;
    if (target.id !== g.orgId) {
      return { status: 403, headers: {}, data: { error: 'Access denied' } };
    }
    return tables.Organization.patch(target.id, data);
  }

  async put(target, data) {
    const g = await tenantGate(this, { requiredRoles: ['owner'] });
    if (g.denied) return g.response;
    if (target.id !== g.orgId) {
      return { status: 403, headers: {}, data: { error: 'Access denied' } };
    }
    return tables.Organization.put({ id: target.id, ...data });
  }

  async delete(target) {
    const g = await tenantGate(this, { requiredRoles: ['owner'] });
    if (g.denied) return g.response;
    if (target.id !== g.orgId) {
      return { status: 403, headers: {}, data: { error: 'Access denied' } };
    }
    return tables.Organization.delete(target.id);
  }
}

// ── User Resource ──────────────────────────────────────────────────

export class User extends tables.User {
  static loadAsInstance = false;

  async get(query) {
    const g = await tenantGate(this);
    if (g.denied) return g.response;

    if (query.id) {
      const user = await tables.User.get(query.id);
      if (!user || user.orgId !== g.orgId) {
        return { status: 404, headers: {}, data: { error: 'User not found' } };
      }
      // Members can only see themselves
      if (g.user.role === 'member' && query.id !== g.user.id) {
        return { status: 403, headers: {}, data: { error: 'Access denied' } };
      }
      const { passwordHash, ...safe } = user;
      return safe;
    }

    // List users in org
    if (g.user.role === 'member') {
      // Members only see themselves
      const { passwordHash, ...safe } = g.user;
      return [safe];
    }

    const users = [];
    for await (const u of await tables.User.search({
      conditions: [{ attribute: 'orgId', value: g.orgId }],
    })) {
      const { passwordHash, ...safe } = u;
      users.push(safe);
    }
    return users;
  }

  async post(target, data) {
    const context = this.getContext();
    const callerUserId = context.headers.get('x-user-id');

    if (callerUserId) {
      // Authenticated: owner/admin creating users in their org
      const g = await tenantGate(this, { requiredRoles: ['owner', 'admin'] });
      if (g.denied) return g.response;
      data.orgId = g.orgId; // Force to caller's org
    } else {
      // Unauthenticated: registration flow — orgId required in body
      if (!data.orgId) {
        return { status: 400, headers: {}, data: { error: 'orgId required for registration' } };
      }
      const org = await tables.Organization.get(data.orgId);
      if (!org) {
        return { status: 400, headers: {}, data: { error: 'Organization not found' } };
      }
    }

    if (!data.active && data.active !== false) data.active = true;
    return tables.User.post(data);
  }

  async patch(target, data) {
    const g = await tenantGate(this);
    if (g.denied) return g.response;

    const targetUser = await tables.User.get(target.id);
    if (!targetUser || targetUser.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'User not found' } };
    }

    if (g.user.role === 'member') {
      // Members can only update themselves (not their role)
      if (target.id !== g.user.id) {
        return { status: 403, headers: {}, data: { error: 'Access denied' } };
      }
      delete data.role;
      delete data.orgId;
    }

    if (g.user.role === 'admin') {
      if (targetUser.role === 'owner') {
        return { status: 403, headers: {}, data: { error: 'Cannot modify owner' } };
      }
      if (data.role === 'owner') {
        return { status: 403, headers: {}, data: { error: 'Cannot promote to owner' } };
      }
    }

    delete data.orgId; // Never allow changing orgId
    return tables.User.patch(target.id, data);
  }

  async delete(target) {
    const g = await tenantGate(this, { requiredRoles: ['owner', 'admin'] });
    if (g.denied) return g.response;

    const targetUser = await tables.User.get(target.id);
    if (!targetUser || targetUser.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'User not found' } };
    }
    if (targetUser.role === 'owner' && g.user.role !== 'owner') {
      return { status: 403, headers: {}, data: { error: 'Cannot delete owner' } };
    }

    return tables.User.delete(target.id);
  }
}

// ── Project Resource ───────────────────────────────────────────────

export class Project extends tables.Project {
  static loadAsInstance = false;

  async get(query) {
    const g = await tenantGate(this);
    if (g.denied) return g.response;

    if (query.id) {
      const project = await tables.Project.get(query.id);
      if (!project || project.orgId !== g.orgId) {
        return { status: 404, headers: {}, data: { error: 'Project not found' } };
      }
      return project;
    }

    const projects = [];
    for await (const p of await tables.Project.search({
      conditions: [{ attribute: 'orgId', value: g.orgId }],
    })) {
      projects.push(p);
    }
    return projects;
  }

  async post(target, data) {
    const g = await tenantGate(this, { requiredRoles: ['owner', 'admin'] });
    if (g.denied) return g.response;
    data.orgId = g.orgId;
    data.status = data.status || 'active';
    return tables.Project.post(data);
  }

  async patch(target, data) {
    const g = await tenantGate(this, { requiredRoles: ['owner', 'admin'] });
    if (g.denied) return g.response;
    const project = await tables.Project.get(target.id);
    if (!project || project.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'Project not found' } };
    }
    delete data.orgId;
    return tables.Project.patch(target.id, data);
  }

  async put(target, data) {
    const g = await tenantGate(this, { requiredRoles: ['owner', 'admin'] });
    if (g.denied) return g.response;
    const project = await tables.Project.get(target.id);
    if (!project || project.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'Project not found' } };
    }
    data.orgId = g.orgId;
    return tables.Project.put({ id: target.id, ...data });
  }

  async delete(target) {
    const g = await tenantGate(this, { requiredRoles: ['owner', 'admin'] });
    if (g.denied) return g.response;
    const project = await tables.Project.get(target.id);
    if (!project || project.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'Project not found' } };
    }
    return tables.Project.delete(target.id);
  }
}

// ── Task Resource (with real-time MQTT) ────────────────────────────

export class Task extends tables.Task {
  static loadAsInstance = false;

  async get(query) {
    const g = await tenantGate(this);
    if (g.denied) return g.response;

    // Project-scoped listing: /Task/project/<projectId>
    if (query.id && String(query.id).startsWith('project/')) {
      const projectId = String(query.id).slice(8);
      const project = await tables.Project.get(projectId);
      if (!project || project.orgId !== g.orgId) {
        return { status: 404, headers: {}, data: { error: 'Project not found' } };
      }
      const tasks = [];
      for await (const t of await tables.Task.search({
        conditions: [
          { attribute: 'projectId', value: projectId },
          { attribute: 'orgId', value: g.orgId },
        ],
      })) {
        if (g.user.role === 'member' && t.assigneeId !== g.user.id) continue;
        tasks.push(t);
      }
      return tasks;
    }

    // Single task
    if (query.id) {
      const task = await tables.Task.get(query.id);
      if (!task || task.orgId !== g.orgId) {
        return { status: 404, headers: {}, data: { error: 'Task not found' } };
      }
      if (!canAccessTask(g.user, task)) {
        return { status: 403, headers: {}, data: { error: 'Access denied' } };
      }
      return task;
    }

    // List all tasks in org (members see only assigned tasks)
    const tasks = [];
    for await (const t of await tables.Task.search({
      conditions: [{ attribute: 'orgId', value: g.orgId }],
    })) {
      if (g.user.role === 'member' && t.assigneeId !== g.user.id) continue;
      tasks.push(t);
    }
    return tasks;
  }

  async post(target, data) {
    const g = await tenantGate(this, { requiredRoles: ['owner', 'admin'] });
    if (g.denied) return g.response;

    // Verify project belongs to org
    if (data.projectId) {
      const project = await tables.Project.get(data.projectId);
      if (!project || project.orgId !== g.orgId) {
        return { status: 400, headers: {}, data: { error: 'Invalid project' } };
      }
    }

    // Verify assignee belongs to org
    if (data.assigneeId) {
      const assignee = await tables.User.get(data.assigneeId);
      if (!assignee || assignee.orgId !== g.orgId) {
        return { status: 400, headers: {}, data: { error: 'Invalid assignee' } };
      }
    }

    data.orgId = g.orgId;
    data.status = data.status || 'todo';
    const result = await tables.Task.post(data);

    // Real-time update scoped to org via MQTT
    try {
      await tables.Task.publish(`org/${g.orgId}/tasks`, {
        action: 'created',
        task: { ...data, id: result.id || result },
      });
    } catch (e) { /* MQTT is best-effort */ }

    dashboardCache.delete(g.orgId); // New tasks affect project health
    return result;
  }

  async patch(target, data) {
    const g = await tenantGate(this);
    if (g.denied) return g.response;

    const task = await tables.Task.get(target.id);
    if (!task || task.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'Task not found' } };
    }

    // Members can only update tasks assigned to them (status only)
    if (g.user.role === 'member') {
      if (task.assigneeId !== g.user.id) {
        return { status: 403, headers: {}, data: { error: 'Access denied' } };
      }
      data = { status: data.status };
    }

    // Track completion time
    if (data.status === 'done' && task.status !== 'done') {
      data.completedAt = Date.now();
      dashboardCache.delete(g.orgId); // Invalidate cached dashboard
    }

    delete data.orgId;
    const result = await tables.Task.patch(target.id, data);

    // Real-time update scoped to org via MQTT
    try {
      await tables.Task.publish(`org/${g.orgId}/tasks`, {
        action: 'updated',
        task: { ...task, ...data },
      });
    } catch (e) { /* MQTT is best-effort */ }

    return result;
  }

  async put(target, data) {
    const g = await tenantGate(this, { requiredRoles: ['owner', 'admin'] });
    if (g.denied) return g.response;

    const task = await tables.Task.get(target.id);
    if (!task || task.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'Task not found' } };
    }

    if (data.status === 'done' && task.status !== 'done') {
      data.completedAt = Date.now();
      dashboardCache.delete(g.orgId);
    }

    data.orgId = g.orgId;
    const result = await tables.Task.put({ id: target.id, ...data });

    try {
      await tables.Task.publish(`org/${g.orgId}/tasks`, {
        action: 'updated',
        task: { id: target.id, ...data },
      });
    } catch (e) { /* MQTT is best-effort */ }

    return result;
  }

  async delete(target) {
    const g = await tenantGate(this, { requiredRoles: ['owner', 'admin'] });
    if (g.denied) return g.response;

    const task = await tables.Task.get(target.id);
    if (!task || task.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'Task not found' } };
    }

    const result = await tables.Task.delete(target.id);

    try {
      await tables.Task.publish(`org/${g.orgId}/tasks`, {
        action: 'deleted',
        taskId: target.id,
      });
    } catch (e) { /* MQTT is best-effort */ }

    dashboardCache.delete(g.orgId);
    return result;
  }
}

// ── Comment Resource (threaded) ────────────────────────────────────

export class Comment extends tables.Comment {
  static loadAsInstance = false;

  async get(query) {
    const g = await tenantGate(this);
    if (g.denied) return g.response;

    // Threaded comments for a task: /Comment/task/<taskId>
    if (query.id && String(query.id).startsWith('task/')) {
      const taskId = String(query.id).slice(5);
      const task = await tables.Task.get(taskId);
      if (!task || task.orgId !== g.orgId) {
        return { status: 404, headers: {}, data: { error: 'Task not found' } };
      }
      if (!canAccessTask(g.user, task)) {
        return { status: 403, headers: {}, data: { error: 'Access denied' } };
      }

      // Fetch all comments for this task
      const flat = [];
      for await (const c of await tables.Comment.search({
        conditions: [
          { attribute: 'taskId', value: taskId },
          { attribute: 'orgId', value: g.orgId },
        ],
      })) {
        flat.push(c);
      }

      // Build threaded tree
      const byId = {};
      const roots = [];
      for (const c of flat) byId[c.id] = { ...c, replies: [] };
      for (const c of flat) {
        if (c.parentId && byId[c.parentId]) {
          byId[c.parentId].replies.push(byId[c.id]);
        } else {
          roots.push(byId[c.id]);
        }
      }
      return roots;
    }

    // Single comment
    if (query.id) {
      const comment = await tables.Comment.get(query.id);
      if (!comment || comment.orgId !== g.orgId) {
        return { status: 404, headers: {}, data: { error: 'Comment not found' } };
      }
      // Verify task access for members
      const task = await tables.Task.get(comment.taskId);
      if (!task || !canAccessTask(g.user, task)) {
        return { status: 403, headers: {}, data: { error: 'Access denied' } };
      }
      return comment;
    }

    // List all comments in org (owner/admin only)
    if (g.user.role === 'member') {
      return { status: 403, headers: {}, data: { error: 'Use /Comment/task/<taskId> to list comments' } };
    }
    const comments = [];
    for await (const c of await tables.Comment.search({
      conditions: [{ attribute: 'orgId', value: g.orgId }],
    })) {
      comments.push(c);
    }
    return comments;
  }

  async post(target, data) {
    const g = await tenantGate(this);
    if (g.denied) return g.response;

    if (!data.taskId) {
      return { status: 400, headers: {}, data: { error: 'taskId required' } };
    }

    // Verify task exists and belongs to user's org
    const task = await tables.Task.get(data.taskId);
    if (!task || task.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'Task not found' } };
    }
    if (!canAccessTask(g.user, task)) {
      return { status: 403, headers: {}, data: { error: 'Access denied' } };
    }

    // Validate parent comment if replying
    if (data.parentId) {
      const parent = await tables.Comment.get(data.parentId);
      if (!parent || parent.taskId !== data.taskId) {
        return { status: 400, headers: {}, data: { error: 'Invalid parent comment' } };
      }
    }

    data.orgId = g.orgId;
    data.authorId = g.user.id;
    return tables.Comment.post(data);
  }

  async patch(target, data) {
    const g = await tenantGate(this);
    if (g.denied) return g.response;

    const comment = await tables.Comment.get(target.id);
    if (!comment || comment.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'Comment not found' } };
    }

    // Only the author can edit
    if (comment.authorId !== g.user.id) {
      return { status: 403, headers: {}, data: { error: 'Only the author can edit this comment' } };
    }

    return tables.Comment.patch(target.id, { body: data.body });
  }

  async delete(target) {
    const g = await tenantGate(this);
    if (g.denied) return g.response;

    const comment = await tables.Comment.get(target.id);
    if (!comment || comment.orgId !== g.orgId) {
      return { status: 404, headers: {}, data: { error: 'Comment not found' } };
    }

    // Author, admin, or owner can delete
    if (comment.authorId !== g.user.id && g.user.role === 'member') {
      return { status: 403, headers: {}, data: { error: 'Access denied' } };
    }

    return tables.Comment.delete(target.id);
  }
}

// ── OrgDashboard Resource (read-only, cached) ──────────────────────

export class OrgDashboard extends tables.OrgDashboard {
  static loadAsInstance = false;

  async get(query) {
    // Dashboard accessible to owners (could extend to admins)
    const g = await tenantGate(this, { requiredRoles: ['owner'] });
    if (g.denied) return g.response;
    return computeDashboard(g.orgId);
  }

  // Dashboard is computed from task data — not directly writable
  async post() {
    return { status: 405, headers: {}, data: { error: 'Dashboard is read-only' } };
  }

  async put() {
    return { status: 405, headers: {}, data: { error: 'Dashboard is read-only' } };
  }

  async patch() {
    return { status: 405, headers: {}, data: { error: 'Dashboard is read-only' } };
  }

  async delete() {
    return { status: 405, headers: {}, data: { error: 'Dashboard is read-only' } };
  }
}
