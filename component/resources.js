// Event Ticketing System — Tier 6
// Seat holds, concurrent checkout safety, waitlist with MQTT notifications, browse caching

const HOLD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function httpError(message, statusCode) {
	const error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

function generateETag(data) {
	const str = typeof data === 'string' ? data : JSON.stringify(data);
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
	}
	return `"${Math.abs(hash).toString(36)}"`;
}

// ---- Hold expiry management ----

async function releaseExpiredHolds() {
	const now = Date.now();
	const expiredHolds = [];
	for await (const hold of tables.Hold.search({
		conditions: [{ attribute: 'status', value: 'active' }],
		limit: 100,
	})) {
		if (hold.expiresAt <= now) {
			expiredHolds.push(hold);
		}
	}
	for (const hold of expiredHolds) {
		await releaseHold(hold);
	}
	return expiredHolds.length;
}

async function releaseHold(hold) {
	// Mark hold as expired
	await tables.Hold.patch(hold.id, { status: 'expired' });

	// Release each seat
	const releasedSeatIds = [];
	for (const seatId of (hold.seatIds || [])) {
		const seat = await tables.Seat.get(seatId);
		if (seat && seat.holdId === hold.id && seat.status === 'held') {
			await tables.Seat.patch(seatId, {
				status: 'available',
				holdId: null,
				holdExpiresAt: null,
			});
			releasedSeatIds.push(seatId);
		}
	}

	// Notify waitlist subscribers that seats opened up
	if (releasedSeatIds.length > 0) {
		await notifyWaitlist(hold.eventId, releasedSeatIds);
	}
}

async function notifyWaitlist(eventId, releasedSeatIds) {
	// Find waiting users for this event
	const waiters = [];
	for await (const entry of tables.Waitlist.search({
		conditions: [
			{ attribute: 'eventId', value: eventId },
			{ attribute: 'status', value: 'waiting' },
		],
		limit: 50,
	})) {
		waiters.push(entry);
	}

	if (waiters.length === 0) return;

	// Get section info for released seats
	const sectionIds = new Set();
	for (const seatId of releasedSeatIds) {
		const seat = await tables.Seat.get(seatId);
		if (seat) sectionIds.add(seat.sectionId);
	}

	const notification = {
		type: 'seats_available',
		eventId,
		seatCount: releasedSeatIds.length,
		sections: [...sectionIds],
		timestamp: Date.now(),
	};

	// Publish MQTT notification
	try {
		if (typeof publish === 'function') {
			publish(`ticketing/events/${eventId}/waitlist`, JSON.stringify(notification));
		}
	} catch (e) {
		// MQTT publish is best-effort
	}

	// Mark waiters as notified
	for (const waiter of waiters) {
		// If waiter has a section preference, only notify if matching
		if (waiter.sectionId && !sectionIds.has(waiter.sectionId)) continue;
		await tables.Waitlist.patch(waiter.id, {
			status: 'notified',
			notifiedAt: Date.now(),
		});
	}
}

// ---- Event Resource ----

export class Event extends tables.Event {
	static loadAsInstance = false;

	async get(target) {
		// Release expired holds on any read (lazy cleanup)
		releaseExpiredHolds().catch(() => {});

		const context = this.getContext();

		// Browse endpoint: GET /Event/?category=music&venue=xxx&dateFrom=...&dateTo=...
		if (!target.id) {
			return this.browse(target, context);
		}

		// Detail endpoint: GET /Event/<id>
		return this.detail(target, context);
	}

	async browse(target, context) {
		const category = target.get('category');
		const venueId = target.get('venueId');
		const dateFrom = target.get('dateFrom');
		const dateTo = target.get('dateTo');

		const conditions = [];
		if (category) conditions.push({ attribute: 'category', value: category });
		if (venueId) conditions.push({ attribute: 'venueId', value: venueId });

		const results = [];
		const searchOpts = conditions.length > 0 ? { conditions, limit: 100 } : { limit: 100 };
		for await (const event of tables.Event.search(searchOpts)) {
			// Date filtering
			if (dateFrom && event.date < parseFloat(dateFrom)) continue;
			if (dateTo && event.date > parseFloat(dateTo)) continue;
			results.push(event);
		}

		// Sort by date ascending
		results.sort((a, b) => (a.date || 0) - (b.date || 0));

		const etag = generateETag(results);
		const ifNoneMatch = context.headers?.get('if-none-match');
		if (ifNoneMatch && ifNoneMatch === etag) {
			return { status: 304, headers: { 'ETag': etag, 'Cache-Control': 'max-age=30, must-revalidate' } };
		}

		return {
			status: 200,
			headers: {
				'ETag': etag,
				'Cache-Control': 'max-age=30, must-revalidate',
			},
			data: results,
		};
	}

	async detail(target, context) {
		const event = await super.get(target);
		if (!event) return event;

		// Get venue info
		let venue = null;
		if (event.venueId) {
			venue = await tables.Venue.get(event.venueId);
		}

		// Get sections with availability and pricing
		const sections = [];
		if (event.venueId) {
			for await (const section of tables.Section.search({
				conditions: [{ attribute: 'venueId', value: event.venueId }],
				limit: 100,
			})) {
				// Count available seats for this section and event
				let available = 0;
				let total = 0;
				for await (const seat of tables.Seat.search({
					conditions: [
						{ attribute: 'sectionId', value: section.id },
						{ attribute: 'eventId', value: event.id },
					],
					limit: 10000,
				})) {
					total++;
					// Check for expired holds inline
					if (seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt <= Date.now()) {
						await tables.Seat.patch(seat.id, {
							status: 'available',
							holdId: null,
							holdExpiresAt: null,
						});
						available++;
					} else if (seat.status === 'available') {
						available++;
					}
				}
				sections.push({
					id: section.id,
					name: section.name,
					price: section.price,
					rows: section.rows,
					seatsPerRow: section.seatsPerRow,
					totalSeats: total,
					availableSeats: available,
				});
			}
		}

		const detail = {
			...event,
			venue: venue ? { id: venue.id, name: venue.name, address: venue.address, city: venue.city } : null,
			sections,
		};

		const etag = generateETag(detail);
		const ifNoneMatch = context.headers?.get('if-none-match');
		if (ifNoneMatch && ifNoneMatch === etag) {
			return { status: 304, headers: { 'ETag': etag, 'Cache-Control': 'max-age=10, must-revalidate' } };
		}

		return {
			status: 200,
			headers: {
				'ETag': etag,
				'Cache-Control': 'max-age=10, must-revalidate',
			},
			data: detail,
		};
	}

	async post(target, data) {
		if (!data.name || data.name.trim() === '') throw httpError('name is required', 400);
		if (!data.venueId) throw httpError('venueId is required', 400);
		if (!data.date) throw httpError('date is required', 400);
		if (!data.category) throw httpError('category is required', 400);

		const venue = await tables.Venue.get(data.venueId);
		if (!venue) throw httpError('Venue not found', 404);

		if (!data.status) data.status = 'upcoming';
		return super.post(target, data);
	}
}

// ---- Seat Resource ----

export class Seat extends tables.Seat {
	static loadAsInstance = false;

	async get(target) {
		if (!target.id) {
			// Collection: filter by eventId and sectionId
			const eventId = target.get('eventId');
			const sectionId = target.get('sectionId');
			const statusFilter = target.get('status');

			const conditions = [];
			if (eventId) conditions.push({ attribute: 'eventId', value: eventId });
			if (sectionId) conditions.push({ attribute: 'sectionId', value: sectionId });
			if (statusFilter) conditions.push({ attribute: 'status', value: statusFilter });

			const results = [];
			const searchOpts = conditions.length > 0 ? { conditions, limit: 10000 } : { limit: 10000 };
			for await (const seat of tables.Seat.search(searchOpts)) {
				// Inline expired hold cleanup
				if (seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt <= Date.now()) {
					await tables.Seat.patch(seat.id, {
						status: 'available',
						holdId: null,
						holdExpiresAt: null,
					});
					// Return cleaned-up version (records are read-only)
					const cleaned = { ...seat, status: 'available', holdId: null, holdExpiresAt: null };
					if (!statusFilter || cleaned.status === statusFilter) results.push(cleaned);
					continue;
				}
				if (statusFilter && seat.status !== statusFilter) continue;
				results.push(seat);
			}
			return results;
		}

		const seat = await super.get(target);
		if (seat && seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt <= Date.now()) {
			await tables.Seat.patch(seat.id, {
				status: 'available',
				holdId: null,
				holdExpiresAt: null,
			});
			// Return cleaned-up copy (records are read-only)
			return { ...seat, status: 'available', holdId: null, holdExpiresAt: null };
		}
		return seat;
	}
}

// ---- Hold Resource ----

export class Hold extends tables.Hold {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.eventId) throw httpError('eventId is required', 400);
		if (!data.seatIds || !Array.isArray(data.seatIds) || data.seatIds.length === 0) {
			throw httpError('seatIds is required and must be a non-empty array', 400);
		}
		if (!data.userId) throw httpError('userId is required', 400);

		// Verify event exists
		const event = await tables.Event.get(data.eventId);
		if (!event) throw httpError('Event not found', 404);

		const now = Date.now();
		const holdId = data.id || `hold-${now}-${Math.random().toString(36).slice(2, 8)}`;
		const expiresAt = now + HOLD_TIMEOUT_MS;

		// Phase 1: Validate seats exist and belong to the event
		for (const seatId of data.seatIds) {
			const seat = await tables.Seat.get(seatId);
			if (!seat) throw httpError(`Seat ${seatId} not found`, 404);
			if (seat.eventId !== data.eventId) {
				throw httpError(`Seat ${seatId} does not belong to event ${data.eventId}`, 400);
			}

			// Check for expired holds and release them
			if (seat.status === 'held' && seat.holdExpiresAt && seat.holdExpiresAt <= now) {
				if (seat.holdId) {
					const oldHold = await tables.Hold.get(seat.holdId);
					if (oldHold && oldHold.status === 'active') {
						await tables.Hold.patch(seat.holdId, { status: 'expired' });
					}
				}
				await tables.Seat.patch(seatId, {
					status: 'available',
					holdId: null,
					holdExpiresAt: null,
				});
			} else if (seat.status !== 'available') {
				throw httpError(`Seat ${seatId} is not available (status: ${seat.status})`, 409);
			}
		}

		// Phase 2: Create the hold record first
		await tables.Hold.put({
			id: holdId,
			eventId: data.eventId,
			seatIds: data.seatIds,
			userId: data.userId,
			expiresAt,
			status: 'active',
		});

		// Phase 3: Write-then-verify pattern for concurrent safety
		// Write our holdId to each seat, then verify we still own it
		const claimedSeats = [];
		try {
			for (const seatId of data.seatIds) {
				// Optimistic write — claim the seat
				await tables.Seat.patch(seatId, {
					status: 'held',
					holdId,
					holdExpiresAt: expiresAt,
				});
				claimedSeats.push(seatId);
			}

			// Verify: re-read each seat to confirm our holdId persisted
			// If another concurrent request overwrote our holdId, we lost the race
			for (const seatId of data.seatIds) {
				const verified = await tables.Seat.get(seatId);
				if (verified.holdId !== holdId) {
					// We lost the race — another request claimed this seat
					throw httpError(`Seat ${seatId} was claimed by another request`, 409);
				}
			}

			return {
				id: holdId,
				eventId: data.eventId,
				seatIds: data.seatIds,
				userId: data.userId,
				expiresAt,
				status: 'active',
			};
		} catch (e) {
			// Rollback: release any seats we claimed
			await tables.Hold.patch(holdId, { status: 'failed' });
			for (const claimedId of claimedSeats) {
				const s = await tables.Seat.get(claimedId);
				if (s && s.holdId === holdId) {
					await tables.Seat.patch(claimedId, {
						status: 'available',
						holdId: null,
						holdExpiresAt: null,
					});
				}
			}
			if (e.statusCode) throw e;
			throw httpError('Hold creation failed: ' + e.message, 500);
		}
	}

	async get(target) {
		if (target.id) {
			const hold = await super.get(target);
			if (hold && hold.status === 'active' && hold.expiresAt <= Date.now()) {
				await releaseHold(hold);
				return { ...hold, status: 'expired' };
			}
			return hold;
		}
		return super.get(target);
	}

	async delete(target) {
		if (!target.id) throw httpError('Hold ID is required', 400);
		const hold = await tables.Hold.get(target.id);
		if (!hold) throw httpError('Hold not found', 404);

		if (hold.status === 'active') {
			await releaseHold(hold);
		}
		return { message: 'Hold cancelled', id: hold.id };
	}
}

// ---- Purchase Resource ----

export class Purchase extends tables.Purchase {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.holdId) throw httpError('holdId is required', 400);
		if (!data.userId) throw httpError('userId is required', 400);

		const hold = await tables.Hold.get(data.holdId);
		if (!hold) throw httpError('Hold not found', 404);

		// Check hold belongs to this user
		if (hold.userId !== data.userId) {
			throw httpError('Hold does not belong to this user', 403);
		}

		// Check hold is still active
		if (hold.status !== 'active') {
			throw httpError(`Hold is ${hold.status}, cannot purchase`, 409);
		}

		// Check hold hasn't expired
		if (hold.expiresAt <= Date.now()) {
			await releaseHold(hold);
			throw httpError('Hold has expired', 409);
		}

		// Calculate total price
		let totalPrice = 0;
		for (const seatId of hold.seatIds) {
			const seat = await tables.Seat.get(seatId);
			if (!seat || seat.status !== 'held' || seat.holdId !== hold.id) {
				throw httpError(`Seat ${seatId} is no longer held`, 409);
			}
			const section = await tables.Section.get(seat.sectionId);
			if (section) totalPrice += section.price || 0;
		}

		// Create purchase
		const purchaseId = data.id || `purchase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

		await tables.Purchase.put({
			id: purchaseId,
			eventId: hold.eventId,
			holdId: hold.id,
			seatIds: hold.seatIds,
			userId: data.userId,
			totalPrice,
			status: 'confirmed',
		});

		// Mark seats as purchased
		for (const seatId of hold.seatIds) {
			await tables.Seat.patch(seatId, {
				status: 'purchased',
				purchaseId,
				holdId: null,
				holdExpiresAt: null,
			});
		}

		// Mark hold as completed
		await tables.Hold.patch(hold.id, { status: 'completed' });

		return {
			id: purchaseId,
			eventId: hold.eventId,
			seatIds: hold.seatIds,
			userId: data.userId,
			totalPrice,
			status: 'confirmed',
		};
	}
}

// ---- Waitlist Resource ----

export class Waitlist extends tables.Waitlist {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.eventId) throw httpError('eventId is required', 400);
		if (!data.userId) throw httpError('userId is required', 400);

		const event = await tables.Event.get(data.eventId);
		if (!event) throw httpError('Event not found', 404);

		// Check if user is already on the waitlist for this event
		for await (const existing of tables.Waitlist.search({
			conditions: [
				{ attribute: 'eventId', value: data.eventId },
				{ attribute: 'userId', value: data.userId },
				{ attribute: 'status', value: 'waiting' },
			],
			limit: 1,
		})) {
			throw httpError('User is already on the waitlist for this event', 409);
		}

		const waitlistId = data.id || `wl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

		await tables.Waitlist.put({
			id: waitlistId,
			eventId: data.eventId,
			userId: data.userId,
			sectionId: data.sectionId || null,
			status: 'waiting',
		});

		// Subscribe user to MQTT topic for this event
		const mqttTopic = `ticketing/events/${data.eventId}/waitlist`;

		return {
			id: waitlistId,
			eventId: data.eventId,
			userId: data.userId,
			sectionId: data.sectionId || null,
			status: 'waiting',
			mqttTopic,
		};
	}

	async get(target) {
		if (!target.id) {
			const eventId = target.get('eventId');
			const userId = target.get('userId');
			const conditions = [];
			if (eventId) conditions.push({ attribute: 'eventId', value: eventId });
			if (userId) conditions.push({ attribute: 'userId', value: userId });

			const results = [];
			const searchOpts = conditions.length > 0 ? { conditions, limit: 100 } : { limit: 100 };
			for await (const entry of tables.Waitlist.search(searchOpts)) {
				results.push(entry);
			}
			return results;
		}
		return super.get(target);
	}
}
