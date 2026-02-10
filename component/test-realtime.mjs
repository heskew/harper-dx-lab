import mqtt from 'mqtt';

const REST_URL = 'http://harper:9926';
const MQTT_URL = 'mqtt://harper:1883';
const AUTH = 'Basic ' + Buffer.from('admin:password').toString('base64');

let passed = 0;
let failed = 0;

function assert(condition, message) {
	if (condition) {
		console.log(`  PASS: ${message}`);
		passed++;
	} else {
		console.log(`  FAIL: ${message}`);
		failed++;
	}
}

async function rest(method, path, body) {
	const opts = {
		method,
		headers: {
			'Authorization': AUTH,
			'Content-Type': 'application/json',
		},
	};
	if (body) opts.body = JSON.stringify(body);
	const res = await fetch(`${REST_URL}${path}`, opts);
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

// ============================================================
// TEST 1: CRUD Operations
// ============================================================
console.log('\n=== TEST 1: CRUD Operations ===\n');

// Clean up any existing data
const existingNotifs = await rest('GET', '/Notification/');
for (const n of (Array.isArray(existingNotifs) ? existingNotifs : [])) {
	await rest('DELETE', `/Notification/${n.id}`);
}
const existingChannels = await rest('GET', '/Channel/');
for (const ch of (Array.isArray(existingChannels) ? existingChannels : [])) {
	await rest('DELETE', `/Channel/${ch.id}`);
}

// Create channels
const ch1Id = await rest('POST', '/Channel/', { name: 'infra', description: 'Infrastructure alerts' });
assert(typeof ch1Id === 'string' && ch1Id.length > 0, 'Create channel returns ID');

const ch2Id = await rest('POST', '/Channel/', { name: 'deploys', description: 'Deployment notifications' });
assert(typeof ch2Id === 'string', 'Create second channel');

// Read channels
const channels = await rest('GET', '/Channel/');
assert(Array.isArray(channels) && channels.length === 2, 'List channels returns 2');

const ch1 = await rest('GET', `/Channel/${ch1Id}`);
assert(ch1.name === 'infra', 'Get channel by ID');

// Update channel
await rest('PUT', `/Channel/${ch1Id}`, { name: 'infra', description: 'Updated infra alerts' });
const ch1Updated = await rest('GET', `/Channel/${ch1Id}`);
assert(ch1Updated.description === 'Updated infra alerts', 'Update channel via PUT');

// Create notifications with read=false explicitly
const n1Id = await rest('POST', '/Notification/', {
	title: 'Server up',
	body: 'Server is online',
	severity: 'info',
	channelId: ch1Id,
	read: false,
});
assert(typeof n1Id === 'string', 'Create info notification');

const n2Id = await rest('POST', '/Notification/', {
	title: 'High memory',
	body: 'Memory above 80%',
	severity: 'warning',
	channelId: ch1Id,
	read: false,
});
assert(typeof n2Id === 'string', 'Create warning notification');

const n3Id = await rest('POST', '/Notification/', {
	title: 'Deploy started',
	body: 'v2.0 deploy to prod',
	severity: 'info',
	channelId: ch2Id,
	read: false,
});
assert(typeof n3Id === 'string', 'Create notification in second channel');

// Read notification
const n1 = await rest('GET', `/Notification/${n1Id}`);
assert(n1.title === 'Server up' && n1.severity === 'info', 'Get notification by ID');

// Filter by severity
const warnings = await rest('GET', '/Notification/?severity=warning');
assert(Array.isArray(warnings) && warnings.length === 1, 'Filter by severity=warning');

// Filter by read status
const unread = await rest('GET', '/Notification/?read=false');
assert(Array.isArray(unread) && unread.length >= 1, 'Filter by read=false');

// Mark as read (PATCH)
await rest('PATCH', `/Notification/${n1Id}`, { read: true });
const n1Read = await rest('GET', `/Notification/${n1Id}`);
assert(n1Read.read === true, 'PATCH mark notification as read');

// Filter by read=true
const readNotifs = await rest('GET', '/Notification/?read=true');
assert(Array.isArray(readNotifs) && readNotifs.length >= 1, 'Filter by read=true');

// Nested query - channel with notifications
const chWithNotifs = await rest('GET', `/Channel/${ch1Id}?select(name,notifications)`);
assert(chWithNotifs.notifications && chWithNotifs.notifications.length === 2, 'Nested query: channel notifications');

// Filter by channelId
const ch1Notifs = await rest('GET', `/Notification/?channelId=${ch1Id}`);
assert(Array.isArray(ch1Notifs) && ch1Notifs.length === 2, 'Filter by channelId');

// Delete notification
const delResult = await rest('DELETE', `/Notification/${n3Id}`);
assert(delResult === true, 'Delete notification');

const afterDel = await rest('GET', '/Notification/');
assert(Array.isArray(afterDel) && afterDel.length === 2, 'Notification count after delete');

// Delete channel
const tempChId = await rest('POST', '/Channel/', { name: 'temp', description: 'temp' });
await rest('DELETE', `/Channel/${tempChId}`);
const chAfterDel = await rest('GET', '/Channel/');
assert(chAfterDel.length === 2, 'Delete channel works');

// ============================================================
// TEST 2: MQTT Critical Alert via MQTT Subscription
// ============================================================
console.log('\n=== TEST 2: MQTT Critical Alert via MQTT Subscription ===\n');

await new Promise((resolve) => {
	const timeout = setTimeout(() => {
		client.end(true);
		assert(false, 'MQTT critical alert received on alerts/infra topic (timeout)');
		resolve();
	}, 15000);

	const client = mqtt.connect(MQTT_URL, {
		username: 'admin',
		password: 'password',
		protocolVersion: 5,
	});

	client.on('connect', () => {
		console.log('  MQTT client connected');
		client.subscribe('alerts/infra', { qos: 0 }, (err, granted) => {
			if (err) {
				console.log('  MQTT subscribe error:', err.message);
				clearTimeout(timeout);
				client.end(true);
				assert(false, 'MQTT subscribe to alerts/infra');
				resolve();
				return;
			}
			console.log('  Subscribed to alerts/infra, granted:', JSON.stringify(granted));

			// Post a critical notification
			setTimeout(async () => {
				await rest('POST', '/Notification/', {
					title: 'CRITICAL: System down',
					body: 'Database unreachable',
					severity: 'critical',
					channelId: ch1Id,
					read: false,
				});
				console.log('  Critical notification posted');
			}, 1000);
		});
	});

	client.on('message', (topic, message) => {
		console.log(`  Received on topic '${topic}':`, message.toString().substring(0, 120));
		const data = JSON.parse(message.toString());
		assert(topic === 'alerts/infra', 'MQTT topic is alerts/infra');
		assert(data.severity === 'critical', 'MQTT message severity is critical');
		assert(data.title === 'CRITICAL: System down', 'MQTT message title matches');
		assert(data.channelName === 'infra', 'MQTT message channelName matches');
		clearTimeout(timeout);
		client.end(true);
		resolve();
	});

	client.on('error', (err) => {
		console.log('  MQTT error:', err.message);
	});
});

// ============================================================
// TEST 3: WebSocket Real-time Connection
// ============================================================
console.log('\n=== TEST 3: WebSocket Real-time Connection ===\n');

await new Promise((resolve) => {
	const timeout = setTimeout(() => {
		try { ws.close(); } catch {}
		assert(false, 'WebSocket received notification in real-time (timeout)');
		resolve();
	}, 15000);

	const wsUrl = `ws://harper:9926/Notification/`;
	const ws = new WebSocket(wsUrl, {
		headers: {
			'Authorization': AUTH,
		},
	});

	let messageCount = 0;

	ws.onopen = () => {
		console.log('  WebSocket connected to /Notification/');
		// Post a notification
		setTimeout(async () => {
			await rest('POST', '/Notification/', {
				title: 'WS test notification',
				body: 'Testing WebSocket delivery',
				severity: 'info',
				channelId: ch1Id,
				read: false,
			});
			console.log('  Posted notification for WebSocket test');
		}, 1000);
	};

	ws.onmessage = (event) => {
		messageCount++;
		const raw = typeof event.data === 'string' ? event.data : event.data.toString();
		console.log(`  WebSocket message #${messageCount}:`, raw.substring(0, 120));
		if (messageCount >= 1) {
			assert(true, 'WebSocket received notification in real-time');
			clearTimeout(timeout);
			try { ws.close(); } catch {}
			resolve();
		}
	};

	ws.onerror = (err) => {
		console.log('  WebSocket error:', err.message || JSON.stringify(err));
		clearTimeout(timeout);
		assert(false, 'WebSocket connection (error)');
		resolve();
	};

	ws.onclose = () => {
		console.log('  WebSocket closed');
	};
});

// ============================================================
// Summary
// ============================================================
console.log('\n========================================');
console.log('=== Summary ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log('========================================\n');

process.exit(failed > 0 ? 1 : 0);
