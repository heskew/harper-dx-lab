// Event Ticketing System — Resources
// Handles: seat inventory, holds with timeout, concurrent safety,
// browse with caching, waitlist with real-time notifications

const HOLD_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function httpError(message, statusCode) {
	const error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

function generateETag(records) {
	if (Array.isArray(records)) {
		const maxTs = records.reduce((max, r) => Math.max(max, r.updatedAt || r.createdAt || 0), 0);
		return `"col-${maxTs}-${records.length}"`;
	}
	return `"${records.updatedAt || records.createdAt || Date.now()}"`;
}

// Release expired holds on a seat, returns updated status
async function releaseIfExpired(seat) {
	if (seat.status === 'held' && seat.holdExpiry && seat.holdExpiry < Date.now()) {
		await tables.Seat.patch(seat.id, {
			status: 'available',
			holdUserId: null,
			holdExpiry: null,
		});
		// Notify waitlist asynchronously
		notifyWaitlist(seat.eventId).catch(() => {});
		return { ...seat, status: 'available', holdUserId: null, holdExpiry: null };
	}
	return seat;
}

// Notify first waitlist entry when seats become available
async function notifyWaitlist(eventId) {
	const entries = [];
	for await (const entry of tables.WaitlistEntry.search({
		conditions: [
			{ attribute: 'eventId', value: eventId },
			{ attribute: 'notified', value: false },
		],
		sort: { attribute: 'createdAt', descending: false },
		limit: 1,
	})) {
		entries.push(entry);
	}
	if (entries.length > 0) {
		const entry = entries[0];
		await tables.WaitlistEntry.patch(entry.id, { notified: true });
		// Publish to MQTT waitlist-alerts topic
		try {
			tables.WaitlistAlert.publish(eventId, {
				type: 'seats_available',
				eventId,
				userId: entry.userId,
				waitlistEntryId: entry.id,
				timestamp: Date.now(),
			});
		} catch (e) {
			// Don't let notification errors block the flow
		}
	}
}

// === Event Resource ===
export class Event extends tables.Event {
	static loadAsInstance = false;

	async get(target) {
		const context = this.getContext();
		const ifNoneMatch = context.headers?.get('if-none-match');

		if (target.id) {
			return this.getEventDetail(target, ifNoneMatch);
		}

		// Browse/listing endpoint with filtering and caching
		return this.browseEvents(target, ifNoneMatch);
	}

	async getEventDetail(target, ifNoneMatch) {
		const event = await super.get(target);
		if (!event) return event;

		const etag = generateETag(event);
		if (ifNoneMatch && ifNoneMatch === etag) {
			return { status: 304, headers: { 'ETag': etag, 'Cache-Control': 'max-age=30, must-revalidate' } };
		}

		// Build availability by section
		const sections = [];
		for await (const section of tables.Section.search({
			conditions: [{ attribute: 'venueId', value: event.venueId }],
		})) {
			let available = 0;
			let total = 0;
			for await (const seat of tables.Seat.search({
				conditions: [
					{ attribute: 'eventId', value: event.id },
					{ attribute: 'sectionId', value: section.id },
				],
			})) {
				total++;
				const resolved = await releaseIfExpired(seat);
				if (resolved.status === 'available') available++;
			}
			sections.push({
				id: section.id,
				name: section.name,
				price: section.price,
				available,
				total,
			});
		}

		return {
			status: 200,
			headers: {
				'ETag': etag,
				'Cache-Control': 'max-age=30, must-revalidate',
			},
			data: {
				...event,
				sections,
			},
		};
	}

	async browseEvents(target, ifNoneMatch) {
		const category = target.get('category');
		const venueId = target.get('venueId');
		const dateFrom = target.get('dateFrom');
		const dateTo = target.get('dateTo');

		const conditions = [];
		if (category) conditions.push({ attribute: 'category', value: category });
		if (venueId) conditions.push({ attribute: 'venueId', value: venueId });

		const results = [];
		const searchOpts = conditions.length > 0 ? { conditions } : {};

		for await (const event of tables.Event.search(searchOpts)) {
			// Date range filtering
			if (dateFrom && event.date < parseFloat(dateFrom)) continue;
			if (dateTo && event.date > parseFloat(dateTo)) continue;
			results.push(event);
		}

		const etag = generateETag(results);
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

	async post(target, data) {
		if (!data.name) throw httpError('name is required', 400);
		if (!data.venueId) throw httpError('venueId is required', 400);
		if (!data.category) throw httpError('category is required', 400);
		if (!data.date) throw httpError('date is required', 400);

		const venue = await tables.Venue.get(data.venueId);
		if (!venue) throw httpError(`Venue ${data.venueId} not found`, 404);

		if (!data.status) data.status = 'upcoming';
		return super.post(target, data);
	}
}

// === Seat Resource ===
export class Seat extends tables.Seat {
	static loadAsInstance = false;

	async get(target) {
		if (target.id) {
			const seat = await super.get(target);
			if (!seat) return seat;
			return await releaseIfExpired(seat);
		}
		return super.get(target);
	}

	async patch(target, data) {
		const seat = await tables.Seat.get(target.id);
		if (!seat) throw httpError('Seat not found', 404);

		// Lazy expiry check
		const resolved = await releaseIfExpired(seat);

		// Hold request
		if (data.status === 'held') {
			if (resolved.status !== 'available') {
				throw httpError('Seat is not available', 409);
			}
			if (!data.holdUserId) throw httpError('holdUserId is required for hold', 400);
			data.holdExpiry = Date.now() + HOLD_DURATION_MS;
			return super.patch(target, data);
		}

		// Purchase transition (called from Purchase resource)
		if (data.status === 'purchased') {
			if (resolved.status === 'held' && resolved.holdUserId === data.holdUserId) {
				return super.patch(target, data);
			}
			if (resolved.status !== 'held') {
				throw httpError('Seat must be held before purchasing', 409);
			}
			throw httpError('Seat is held by a different user', 409);
		}

		// Release (cancel hold)
		if (data.status === 'available') {
			if (resolved.status === 'held') {
				const result = await super.patch(target, {
					status: 'available',
					holdUserId: null,
					holdExpiry: null,
				});
				notifyWaitlist(resolved.eventId).catch(() => {});
				return result;
			}
		}

		return super.patch(target, data);
	}
}

// === Purchase Resource ===
export class Purchase extends tables.Purchase {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.eventId) throw httpError('eventId is required', 400);
		if (!data.userId) throw httpError('userId is required', 400);
		if (!data.seatIds || !Array.isArray(data.seatIds) || data.seatIds.length === 0) {
			throw httpError('seatIds must be a non-empty array', 400);
		}

		// Validate all seats are held by this user
		let totalPrice = 0;
		const seats = [];
		for (const seatId of data.seatIds) {
			const seat = await tables.Seat.get(seatId);
			if (!seat) throw httpError(`Seat ${seatId} not found`, 404);

			// Check expiry first
			const resolved = await releaseIfExpired(seat);

			if (resolved.status !== 'held') {
				throw httpError(`Seat ${seatId} is not held — cannot purchase`, 409);
			}
			if (resolved.holdUserId !== data.userId) {
				throw httpError(`Seat ${seatId} is held by a different user`, 409);
			}

			const section = await tables.Section.get(resolved.sectionId);
			totalPrice += section ? section.price : 0;
			seats.push(resolved);
		}

		// Transition all seats to purchased
		for (const seat of seats) {
			await tables.Seat.patch(seat.id, {
				status: 'purchased',
				holdUserId: data.userId,
				holdExpiry: null,
				purchaseId: data.id || `purchase-${Date.now()}`,
			});
		}

		data.totalPrice = totalPrice;
		return super.post(target, data);
	}
}

// === WaitlistEntry Resource ===
export class WaitlistEntry extends tables.WaitlistEntry {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.eventId) throw httpError('eventId is required', 400);
		if (!data.userId) throw httpError('userId is required', 400);

		const event = await tables.Event.get(data.eventId);
		if (!event) throw httpError(`Event ${data.eventId} not found`, 404);

		if (data.notified === undefined) data.notified = false;
		return super.post(target, data);
	}

	async subscribe(subscriptionRequest) {
		return super.subscribe(subscriptionRequest);
	}
}

// === Venue Resource (validation) ===
export class Venue extends tables.Venue {
	static loadAsInstance = false;

	async get(target) {
		const context = this.getContext();
		const ifNoneMatch = context.headers?.get('if-none-match');

		if (target.id) {
			const venue = await super.get(target);
			if (!venue) return venue;
			const etag = generateETag(venue);
			if (ifNoneMatch && ifNoneMatch === etag) {
				return { status: 304, headers: { 'ETag': etag, 'Cache-Control': 'max-age=60, must-revalidate' } };
			}
			return { status: 200, headers: { 'ETag': etag, 'Cache-Control': 'max-age=60, must-revalidate' }, data: venue };
		}
		return super.get(target);
	}

	async post(target, data) {
		if (!data.name) throw httpError('name is required', 400);
		return super.post(target, data);
	}
}

// === Section Resource (validation) ===
export class Section extends tables.Section {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.name) throw httpError('name is required', 400);
		if (!data.venueId) throw httpError('venueId is required', 400);
		const venue = await tables.Venue.get(data.venueId);
		if (!venue) throw httpError(`Venue ${data.venueId} not found`, 404);
		return super.post(target, data);
	}
}
