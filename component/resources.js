const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const TASK_PRIORITIES = ['low', 'medium', 'high'];
const PROJECT_STATUSES = ['active', 'completed', 'archived'];

function badRequest(message) {
	const error = new Error(message);
	error.statusCode = 400;
	return error;
}

function notFound(message) {
	const error = new Error(message);
	error.statusCode = 404;
	return error;
}

async function getIncompleteTasks(projectId) {
	const incomplete = [];
	for await (const task of tables.Task.search({
		conditions: [
			{ attribute: 'projectId', value: projectId },
			{ attribute: 'status', comparator: 'not_equal', value: 'done' },
		],
	})) {
		incomplete.push(task);
	}
	return incomplete;
}

export class Project extends tables.Project {
	static loadAsInstance = false;

	async get(target) {
		// Handle GET /Project/:id/stats
		const pathname = target.pathname || '';
		if (pathname.endsWith('/stats')) {
			// pathname is like /UUID/stats — extract the real ID
			const segments = pathname.split('/').filter(Boolean);
			const projectId = segments[0];

			const project = await tables.Project.get(projectId);
			if (!project) {
				throw notFound(`Project ${projectId} not found`);
			}

			const byStatus = { todo: 0, in_progress: 0, done: 0 };
			const byPriority = { low: 0, medium: 0, high: 0 };
			let total = 0;

			for await (const task of tables.Task.search({
				conditions: [{ attribute: 'projectId', value: projectId }],
			})) {
				total++;
				if (task.status in byStatus) byStatus[task.status]++;
				if (task.priority in byPriority) byPriority[task.priority]++;
			}

			return {
				projectId,
				totalTasks: total,
				byStatus,
				byPriority,
				completionPercentage: total > 0 ? (byStatus.done / total) * 100 : 0,
			};
		}

		return super.get(target);
	}

	async put(target, data) {
		if (data.status === 'completed') {
			const projectId = target.id || data.id;
			const incomplete = await getIncompleteTasks(projectId);
			if (incomplete.length > 0) {
				const list = incomplete.map((t) => `"${t.title}" (${t.status})`).join(', ');
				throw badRequest(
					`Cannot complete project: ${incomplete.length} task(s) not done: ${list}`
				);
			}
		}
		return super.put(target, data);
	}

	async patch(target, data) {
		if (data.status === 'completed') {
			const projectId = target.id;
			const incomplete = await getIncompleteTasks(projectId);
			if (incomplete.length > 0) {
				const list = incomplete.map((t) => `"${t.title}" (${t.status})`).join(', ');
				throw badRequest(
					`Cannot complete project: ${incomplete.length} task(s) not done: ${list}`
				);
			}
		}
		return super.patch(target, data);
	}
}

export class Task extends tables.Task {
	static loadAsInstance = false;

	async post(target, data) {
		// Validate title
		if (!data.title || typeof data.title !== 'string' || data.title.trim() === '') {
			throw badRequest('title is required and must be non-empty');
		}

		// Validate status
		if (!TASK_STATUSES.includes(data.status)) {
			throw badRequest(`status must be one of: ${TASK_STATUSES.join(', ')}`);
		}

		// Validate priority
		if (!TASK_PRIORITIES.includes(data.priority)) {
			throw badRequest(`priority must be one of: ${TASK_PRIORITIES.join(', ')}`);
		}

		// Validate projectId present
		if (!data.projectId) {
			throw badRequest('projectId is required');
		}

		// Validate project exists
		const project = await tables.Project.get(data.projectId);
		if (!project) {
			throw notFound(`Project ${data.projectId} not found`);
		}

		// Validate project is not archived
		if (project.status === 'archived') {
			throw badRequest(`Cannot add tasks to archived project`);
		}

		return super.post(target, data);
	}
}
