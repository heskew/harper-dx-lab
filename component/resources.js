const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const TASK_PRIORITIES = ['low', 'medium', 'high'];

export class Project extends tables.Project {
	static loadAsInstance = false;

	async get(target) {
		const id = target.id;
		if (typeof id === 'string' && id.endsWith('/stats')) {
			const projectId = id.slice(0, -'/stats'.length);
			return this.getStats(projectId);
		}
		return super.get(target);
	}

	async getStats(projectId) {
		const project = await tables.Project.get(projectId);
		if (!project) {
			const error = new Error('Project not found');
			error.statusCode = 404;
			throw error;
		}

		const stats = {
			total: 0,
			byStatus: { todo: 0, in_progress: 0, done: 0 },
			byPriority: { low: 0, medium: 0, high: 0 },
			completionPercentage: 0,
		};

		for await (const task of tables.Task.search({
			conditions: [{ attribute: 'projectId', value: projectId, comparator: 'equals' }],
		})) {
			stats.total++;
			if (task.status in stats.byStatus) {
				stats.byStatus[task.status]++;
			}
			if (task.priority in stats.byPriority) {
				stats.byPriority[task.priority]++;
			}
		}

		if (stats.total > 0) {
			stats.completionPercentage = (stats.byStatus.done / stats.total) * 100;
		}

		return stats;
	}

	async patch(target, data) {
		if (data.status === 'completed') {
			await this.checkAllTasksDone(target.id);
		}
		return super.patch(target, data);
	}

	async put(target, data) {
		if (data.status === 'completed') {
			await this.checkAllTasksDone(target.id);
		}
		return super.put(target, data);
	}

	async checkAllTasksDone(projectId) {
		const incompleteTasks = [];
		for await (const task of tables.Task.search({
			conditions: [
				{ attribute: 'projectId', value: projectId, comparator: 'equals' },
				{ attribute: 'status', value: 'done', comparator: 'not_equal' },
			],
		})) {
			incompleteTasks.push(task.title || task.id);
		}
		if (incompleteTasks.length > 0) {
			const error = new Error(
				`Cannot complete project: ${incompleteTasks.length} incomplete task(s): ${incompleteTasks.join(', ')}`
			);
			error.statusCode = 400;
			throw error;
		}
	}
}

export class Task extends tables.Task {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.title || (typeof data.title === 'string' && data.title.trim() === '')) {
			const error = new Error('title is required and must be non-empty');
			error.statusCode = 400;
			throw error;
		}

		if (!TASK_STATUSES.includes(data.status)) {
			const error = new Error(`status must be one of: ${TASK_STATUSES.join(', ')}`);
			error.statusCode = 400;
			throw error;
		}

		if (!TASK_PRIORITIES.includes(data.priority)) {
			const error = new Error(`priority must be one of: ${TASK_PRIORITIES.join(', ')}`);
			error.statusCode = 400;
			throw error;
		}

		if (!data.projectId) {
			const error = new Error('projectId is required');
			error.statusCode = 400;
			throw error;
		}

		const project = await tables.Project.get(data.projectId);
		if (!project) {
			const error = new Error('Referenced project does not exist');
			error.statusCode = 400;
			throw error;
		}
		if (project.status === 'archived') {
			const error = new Error('Cannot add tasks to an archived project');
			error.statusCode = 400;
			throw error;
		}

		return super.post(target, data);
	}
}
