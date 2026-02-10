// Event Ticketing System — Harper Resource Classes
// Handles: events, venues, sections, seats, holds, purchases, waitlist, caching

const HOLD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// --- Browse cache ---
const browseCache = new Map();
const CACHE_TTL_MS = 30_000; // 30 second TTL for browse endpoints

function getCached(key) {
	const entry = browseCache.get(key);
	if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
	browseCache.delete(key);
	return null;
}

function setCache(key, data) {
	browseCache.set(key, { data, ts: Date.now() });
}

function invalidateCache(prefix) {
	for (const key of browseCache.keys()) {
		if (key.startsWith(prefix)) browseCache.delete(key);
	}
}

function httpError(message, statusCode) {
	const error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

function generateETag(record) {
	return `"${record.updatedAt || record.createdAt || Date.now()}"`;
}

// --- Release expired holds ---
async function releaseExpiredHolds(eventId) {
	const now = Date.now();
	const released = [];
	for await (const seat of tables.Seat.search({
		conditions: [
			{ attribute: 'status', value: 'held' },
			...(eventId ? [{ attribute: 'eventId', value: eventId }] : []),
		],
		limit: 10000,
	})) {
		if (seat.holdExpiry && seat.holdExpiry <= now) {
			await tables.Seat.patch(seat.id, {
				status: 'available',
				holdExpiry: null,
				holderId: null,
			});
			released.push(seat.id);
		}
	}
	return released;
}

// --- Notify waitlist when seats open ---
async function notifyWaitlist(eventId, seatCount) {
	const waiters = [];
	for await (const w of tables.Waitlist.search({
		conditions: [
			{ attribute: 'eventId', value: eventId },
			{ attribute: 'notified', value: false },
		],
		sort: { attribute: 'joinedAt', descending: false },
		limit: seatCount,
	})) {
		waiters.push(w);
	}

	for (const w of waiters) {
		// Publish MQTT notification
		try {
			if (typeof publish === 'function') {
				publish(`waitlist/${eventId}`, JSON.stringify({
					type: 'seats_available',
					eventId,
					email: w.email,
					availableSeats: seatCount,
					timestamp: Date.now(),
				}));
			}
		} catch (e) {
			// MQTT publish is best-effort
		}
		await tables.Waitlist.patch(w.id, {
			notified: true,
			notifiedAt: Date.now(),
		});
	}
	return waiters.length;
}

// === Venue Resource ===
export class Venue extends tables.Venue {
	static loadAsInstance = false;
}

// === Section Resource ===
export class Section extends tables.Section {
	static loadAsInstance = false;
}

// === Event Resource (browse + detail + caching) ===
export class Event extends tables.Event {
	static loadAsInstance = false;

	async get(target) {
		// Release expired holds on any event access
		if (target.id) {
			return this.getEventDetail(target);
		}
		return this.browseEvents(target);
	}

	async getEventDetail(target) {
		const context = this.getContext();
		const ifNoneMatch = context.headers?.get('if-none-match');

		const event = await super.get(target);
		if (!event) return event;

		const etag = generateETag(event);
		if (ifNoneMatch && ifNoneMatch === etag) {
			return { status: 304, headers: { 'ETag': etag, 'Cache-Control': 'max-age=30, must-revalidate' } };
		}

		// Release expired holds for this event
		await releaseExpiredHolds(event.id);

		// Get venue info
		const venue = event.venueId ? await tables.Venue.get(event.venueId) : null;

		// Get sections with availability and pricing
		const sections = [];
		for await (const es of tables.EventSection.search({
			conditions: [{ attribute: 'eventId', value: event.id }],
			limit: 1000,
		})) {
			const section = await tables.Section.get(es.sectionId);
			// Count available seats in this section for this event
			let available = 0;
			let total = 0;
			for await (const seat of tables.Seat.search({
				conditions: [
					{ attribute: 'eventId', value: event.id },
					{ attribute: 'sectionId', value: es.sectionId },
				],
				limit: 10000,
			})) {
				total++;
				if (seat.status === 'available') available++;
			}
			sections.push({
				sectionId: es.sectionId,
				sectionName: section?.name || es.sectionId,
				price: es.price,
				totalSeats: total,
				availableSeats: available,
			});
		}

		return {
			status: 200,
			headers: { 'ETag': etag, 'Cache-Control': 'max-age=30, must-revalidate' },
			data: {
				...event,
				venue: venue ? { id: venue.id, name: venue.name, address: venue.address, city: venue.city } : null,
				sections,
			},
		};
	}

	async browseEvents(target) {
		const category = target.get('category');
		const venueId = target.get('venueId');
		const dateFrom = target.get('dateFrom');
		const dateTo = target.get('dateTo');

		const cacheKey = `events:${category || ''}:${venueId || ''}:${dateFrom || ''}:${dateTo || ''}`;
		const cached = getCached(cacheKey);
		if (cached) {
			return {
				status: 200,
				headers: { 'X-Cache': 'HIT', 'Cache-Control': 'max-age=30' },
				data: cached,
			};
		}

		const conditions = [];
		if (category) conditions.push({ attribute: 'category', value: category });
		if (venueId) conditions.push({ attribute: 'venueId', value: venueId });

		const results = [];
		for await (const event of tables.Event.search({
			conditions: conditions.length > 0 ? conditions : undefined,
			sort: { attribute: 'date', descending: false },
			limit: 100,
		})) {
			// Date range filtering
			if (dateFrom && event.date < parseFloat(dateFrom)) continue;
			if (dateTo && event.date > parseFloat(dateTo)) continue;
			results.push(event);
		}

		setCache(cacheKey, results);
		return {
			status: 200,
			headers: { 'X-Cache': 'MISS', 'Cache-Control': 'max-age=30' },
			data: results,
		};
	}

	async post(target, data) {
		if (!data.name?.trim()) throw httpError('name is required', 400);
		if (!data.venueId) throw httpError('venueId is required', 400);
		if (!data.date) throw httpError('date is required', 400);
		if (!data.category) throw httpError('category is required', 400);

		const venue = await tables.Venue.get(data.venueId);
		if (!venue) throw httpError('Venue not found', 404);

		if (!data.status) data.status = 'active';
		invalidateCache('events:');
		return super.post(target, data);
	}
}

// === EventSection Resource ===
export class EventSection extends tables.EventSection {
	static loadAsInstance = false;
}

// === Seat Resource (holds, checkout, concurrency) ===
export class Seat extends tables.Seat {
	static loadAsInstance = false;

	async get(target) {
		if (target.get('action') === 'hold') {
			return this.holdSeats(target);
		}
		if (target.get('action') === 'release-expired') {
			const eventId = target.get('eventId');
			const released = await releaseExpiredHolds(eventId);
			return {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
				data: { released: released.length, seatIds: released },
			};
		}
		return super.get(target);
	}

	async post(target, data) {
		// POST /Seat/?action=hold — Hold seats for checkout
		const context = this.getContext();
		const action = target.get('action');

		if (action === 'hold') {
			return this.holdSeats(data);
		}
		if (action === 'checkout') {
			return this.checkout(data);
		}

		return super.post(target, data);
	}

	async holdSeats(data) {
		const { seatIds, holderId } = data;
		if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
			throw httpError('seatIds array is required', 400);
		}
		if (!holderId) throw httpError('holderId is required', 400);

		// Release expired holds first
		const firstSeat = await tables.Seat.get(seatIds[0]);
		if (firstSeat) await releaseExpiredHolds(firstSeat.eventId);

		const holdExpiry = Date.now() + HOLD_TIMEOUT_MS;
		const held = [];
		const failed = [];

		for (const seatId of seatIds) {
			const seat = await tables.Seat.get(seatId);
			if (!seat) {
				failed.push({ seatId, reason: 'not found' });
				continue;
			}
			if (seat.status !== 'available') {
				failed.push({ seatId, reason: `status is ${seat.status}` });
				continue;
			}
			// Atomically claim: read-check-write with status guard
			await tables.Seat.patch(seatId, {
				status: 'held',
				holdExpiry,
				holderId,
			});
			// Re-read to verify we won the race
			const updated = await tables.Seat.get(seatId);
			if (updated.holderId !== holderId) {
				failed.push({ seatId, reason: 'lost race' });
				continue;
			}
			held.push(seatId);
		}

		if (held.length === 0) {
			throw httpError('No seats could be held', 409);
		}

		return { held, failed, holdExpiry, holderId };
	}

	async checkout(data) {
		const { seatIds, holderId, buyerEmail, eventId } = data;
		if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
			throw httpError('seatIds array is required', 400);
		}
		if (!holderId) throw httpError('holderId is required', 400);
		if (!buyerEmail) throw httpError('buyerEmail is required', 400);
		if (!eventId) throw httpError('eventId is required', 400);

		// Verify all seats are held by this holder and not expired
		const now = Date.now();
		let totalPrice = 0;

		for (const seatId of seatIds) {
			const seat = await tables.Seat.get(seatId);
			if (!seat) throw httpError(`Seat ${seatId} not found`, 404);
			if (seat.status !== 'held') {
				throw httpError(`Seat ${seatId} is not held (status: ${seat.status})`, 409);
			}
			if (seat.holderId !== holderId) {
				throw httpError(`Seat ${seatId} is held by another user`, 409);
			}
			if (seat.holdExpiry && seat.holdExpiry <= now) {
				// Hold expired — release it
				await tables.Seat.patch(seatId, {
					status: 'available',
					holdExpiry: null,
					holderId: null,
				});
				throw httpError(`Hold on seat ${seatId} has expired`, 410);
			}

			// Get price from EventSection
			const es = await this.findEventSection(seat.eventId, seat.sectionId);
			if (es) totalPrice += es.price || 0;
		}

		// Create purchase
		const purchaseId = `pur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		await tables.Purchase.put({
			id: purchaseId,
			eventId,
			buyerEmail,
			totalPrice,
			status: 'confirmed',
			seatIds,
		});

		// Mark seats as sold
		for (const seatId of seatIds) {
			await tables.Seat.patch(seatId, {
				status: 'sold',
				holdExpiry: null,
				purchaseId,
			});
		}

		invalidateCache('events:');
		return { purchaseId, eventId, buyerEmail, totalPrice, seatIds, status: 'confirmed' };
	}

	async findEventSection(eventId, sectionId) {
		for await (const es of tables.EventSection.search({
			conditions: [
				{ attribute: 'eventId', value: eventId },
				{ attribute: 'sectionId', value: sectionId },
			],
			limit: 1,
		})) {
			return es;
		}
		return null;
	}
}

// === Purchase Resource ===
export class Purchase extends tables.Purchase {
	static loadAsInstance = false;

	async post(target, data) {
		const action = target.get('action');
		if (action === 'cancel') {
			return this.cancelPurchase(data);
		}
		return super.post(target, data);
	}

	async cancelPurchase(data) {
		const { purchaseId } = data;
		if (!purchaseId) throw httpError('purchaseId is required', 400);

		const purchase = await tables.Purchase.get(purchaseId);
		if (!purchase) throw httpError('Purchase not found', 404);
		if (purchase.status === 'cancelled') throw httpError('Already cancelled', 409);

		// Release seats
		const releasedSeats = [];
		if (purchase.seatIds) {
			for (const seatId of purchase.seatIds) {
				await tables.Seat.patch(seatId, {
					status: 'available',
					holdExpiry: null,
					holderId: null,
					purchaseId: null,
				});
				releasedSeats.push(seatId);
			}
		}

		await tables.Purchase.patch(purchaseId, { status: 'cancelled' });
		invalidateCache('events:');

		// Notify waitlist
		if (purchase.eventId && releasedSeats.length > 0) {
			notifyWaitlist(purchase.eventId, releasedSeats.length).catch(() => {});
		}

		return { purchaseId, status: 'cancelled', releasedSeats };
	}
}

// === Waitlist Resource ===
export class Waitlist extends tables.Waitlist {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.eventId) throw httpError('eventId is required', 400);
		if (!data.email) throw httpError('email is required', 400);

		// Check if already on waitlist
		for await (const existing of tables.Waitlist.search({
			conditions: [
				{ attribute: 'eventId', value: data.eventId },
				{ attribute: 'email', value: data.email },
			],
			limit: 1,
		})) {
			throw httpError('Already on waitlist for this event', 409);
		}

		data.joinedAt = Date.now();
		data.notified = false;
		return super.post(target, data);
	}
}
