const SEVERITIES = ['info', 'warning', 'critical'];

export class Channel extends tables.Channel {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.name || (typeof data.name === 'string' && data.name.trim() === '')) {
			const error = new Error('name is required');
			error.statusCode = 400;
			throw error;
		}
		return super.post(target, data);
	}
}

export class Notification extends tables.Notification {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.title || (typeof data.title === 'string' && data.title.trim() === '')) {
			const error = new Error('title is required');
			error.statusCode = 400;
			throw error;
		}
		if (!data.body || (typeof data.body === 'string' && data.body.trim() === '')) {
			const error = new Error('body is required');
			error.statusCode = 400;
			throw error;
		}
		if (!SEVERITIES.includes(data.severity)) {
			const error = new Error(`severity must be one of: ${SEVERITIES.join(', ')}`);
			error.statusCode = 400;
			throw error;
		}
		if (!data.channelId) {
			const error = new Error('channelId is required');
			error.statusCode = 400;
			throw error;
		}

		const channel = await tables.Channel.get(data.channelId);
		if (!channel) {
			const error = new Error(`Channel ${data.channelId} not found`);
			error.statusCode = 404;
			throw error;
		}

		if (data.read === undefined) {
			data.read = false;
		}

		const result = await super.post(target, data);

		// Publish to subscribers of this resource
		this.publish(target, data);

		// If critical, publish to alerts/{channelName} MQTT topic via the Alert table
		if (data.severity === 'critical') {
			try {
				tables.Alert.publish(channel.name, {
					title: data.title,
					body: data.body,
					severity: data.severity,
					channelId: data.channelId,
					channelName: channel.name,
					createdAt: Date.now(),
				}, this);
			} catch (e) {
				console.error('MQTT alert publish error:', e);
			}
		}

		return result;
	}

	async patch(target, data) {
		return super.patch(target, data);
	}

	async subscribe(subscriptionRequest) {
		return super.subscribe(subscriptionRequest);
	}

	async *connect(incomingMessages) {
		const subscription = await tables.Notification.subscribe();
		for await (const message of subscription) {
			yield message;
		}
	}
}
