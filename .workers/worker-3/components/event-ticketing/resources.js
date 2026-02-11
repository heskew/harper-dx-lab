// Event Ticketing System — Harper Resource Classes
// All-in-one: events, venues, sections, seats, holds, purchases, waitlist

const HOLD_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// ── In-memory browse cache ────────────────────────────────────────
const browseCache = new Map();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCached(key) {
  const entry = browseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    browseCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  browseCache.set(key, { data, cachedAt: Date.now() });
}

function invalidateCache(prefix) {
  for (const key of browseCache.keys()) {
    if (key.startsWith(prefix)) browseCache.delete(key);
  }
}

// ── Lazy hold expiry ──────────────────────────────────────────────
// Instead of batch scanning, check and release expired holds on access.
async function expireHoldIfNeeded(seat) {
  if (seat.status === 'held' && seat.holdExpiry && seat.holdExpiry < Date.now()) {
    await tables.Seat.patch(seat.id, {
      status: 'available',
      holdExpiry: null,
      holderId: null,
    });
    // Notify waitlist subscribers that a seat opened up
    notifyWaitlist(seat.eventId, seat.id, seat.sectionId).catch(() => {});
    // Re-read from DB to get the updated record
    const updated = await tables.Seat.get(seat.id);
    return updated || { id: seat.id, eventId: seat.eventId, sectionId: seat.sectionId, row: seat.row, seatNumber: seat.seatNumber, status: 'available', holdExpiry: null, holderId: null };
  }
  return seat;
}

async function notifyWaitlist(eventId, seatId, sectionId) {
  // Find waitlist entries for this event that haven't been notified
  const waitlisters = [];
  for await (const entry of tables.Waitlist.search({
    conditions: [
      { attribute: 'eventId', value: eventId },
      { attribute: 'notified', value: false },
    ],
    limit: 10,
  })) {
    waitlisters.push(entry);
  }

  for (const entry of waitlisters) {
    // Mark as notified
    await tables.Waitlist.patch(entry.id, { notified: true });
  }

  // Publish MQTT notification for real-time subscribers
  if (waitlisters.length > 0) {
    try {
      await tables.Waitlist.publish(`waitlist/event/${eventId}`, {
        type: 'seat_available',
        eventId,
        seatId,
        sectionId,
        timestamp: Date.now(),
        message: 'A seat has become available!',
      });
    } catch (e) {
      // MQTT publish is best-effort
    }
  }
}

// ── Venue Resource ────────────────────────────────────────────────
export class Venue extends tables.Venue {
  static loadAsInstance = false;

  async get(target) {
    if (target.id) {
      const venue = await tables.Venue.get(target.id);
      if (!venue) return { status: 404, headers: {}, data: { error: 'Venue not found' } };
      return venue;
    }
    const cacheKey = 'venues:all';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const results = [];
    for await (const v of tables.Venue.search()) {
      results.push(v);
    }
    setCache(cacheKey, results);
    return results;
  }

  async post(target, data) {
    invalidateCache('venues:');
    if (!data.id) data.id = crypto.randomUUID();
    await tables.Venue.put(data);
    return await tables.Venue.get(data.id) || data;
  }

  async put(target, data) {
    invalidateCache('venues:');
    return tables.Venue.put({ id: target.id, ...data });
  }

  async patch(target, data) {
    invalidateCache('venues:');
    return tables.Venue.patch(target.id, data);
  }

  async delete(target) {
    invalidateCache('venues:');
    return tables.Venue.delete(target.id);
  }
}

// ── Section Resource ──────────────────────────────────────────────
export class Section extends tables.Section {
  static loadAsInstance = false;

  async get(target) {
    if (target.id) {
      const section = await tables.Section.get(target.id);
      if (!section) return { status: 404, headers: {}, data: { error: 'Section not found' } };
      return section;
    }

    const venueId = target.get ? target.get('venueId') : null;
    const conditions = [];
    if (venueId) conditions.push({ attribute: 'venueId', value: venueId });

    const results = [];
    for await (const s of tables.Section.search({
      conditions: conditions.length > 0 ? conditions : undefined,
      sort: { attribute: 'sortOrder' },
    })) {
      results.push(s);
    }
    return results;
  }

  async post(target, data) {
    if (!data.id) data.id = crypto.randomUUID();
    await tables.Section.put(data);
    return await tables.Section.get(data.id) || data;
  }

  async put(target, data) {
    return tables.Section.put({ id: target.id, ...data });
  }

  async patch(target, data) {
    return tables.Section.patch(target.id, data);
  }

  async delete(target) {
    return tables.Section.delete(target.id);
  }
}

// ── Event Resource ────────────────────────────────────────────────
// Browse API with filtering by date, venue, category.
// Detail view shows availability by section with pricing.
export class Event extends tables.Event {
  static loadAsInstance = false;

  async get(target) {
    const context = this.getContext();
    context.responseHeaders.set('x-request-id', crypto.randomUUID());

    // Single event detail — includes section availability map
    if (target.id) {
      return this.getEventDetail(target.id);
    }

    // Browse/listing with filters
    return this.browseEvents(target);
  }

  async getEventDetail(eventId) {
    const event = await tables.Event.get(eventId);
    if (!event) {
      return { status: 404, headers: {}, data: { error: 'Event not found' } };
    }

    const venue = await tables.Venue.get(event.venueId);

    // Build section availability map
    const sectionAvailability = [];
    for await (const section of tables.Section.search({
      conditions: [{ attribute: 'venueId', value: event.venueId }],
      sort: { attribute: 'sortOrder' },
    })) {
      let available = 0;
      let held = 0;
      let sold = 0;
      const totalSeats = section.totalRows * section.seatsPerRow;

      for await (const seat of tables.Seat.search({
        conditions: [
          { attribute: 'eventId', value: eventId },
          { attribute: 'sectionId', value: section.id },
        ],
      })) {
        const resolved = await expireHoldIfNeeded(seat);
        if (resolved.status === 'available') available++;
        else if (resolved.status === 'held') held++;
        else if (resolved.status === 'sold') sold++;
      }

      sectionAvailability.push({
        sectionId: section.id,
        sectionName: section.name,
        priceInCents: section.priceInCents,
        totalSeats,
        available,
        held,
        sold,
      });
    }

    return {
      id: event.id,
      name: event.name,
      description: event.description,
      category: event.category,
      venueId: event.venueId,
      date: event.date,
      imageUrl: event.imageUrl,
      status: event.status,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
      venue: venue ? { id: venue.id, name: venue.name, address: venue.address, city: venue.city } : null,
      sectionAvailability,
    };
  }

  async browseEvents(target) {
    const category = target.get ? target.get('category') : null;
    const venueId = target.get ? target.get('venueId') : null;
    const dateFrom = target.get ? target.get('dateFrom') : null;
    const dateTo = target.get ? target.get('dateTo') : null;
    const status = target.get ? target.get('status') : null;

    const cacheKey = `events:${category || ''}:${venueId || ''}:${dateFrom || ''}:${dateTo || ''}:${status || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // Build search conditions
    const conditions = [];
    if (category) conditions.push({ attribute: 'category', value: category });
    if (venueId) conditions.push({ attribute: 'venueId', value: venueId });
    if (status) conditions.push({ attribute: 'status', value: status });

    const results = [];
    for await (const event of tables.Event.search({
      conditions: conditions.length > 0 ? conditions : undefined,
      sort: { attribute: 'date' },
    })) {
      // Date range filtering (post-query since Harper may not support range conditions)
      if (dateFrom && event.date < parseFloat(dateFrom)) continue;
      if (dateTo && event.date > parseFloat(dateTo)) continue;

      results.push({
        id: event.id,
        name: event.name,
        description: event.description,
        category: event.category,
        venueId: event.venueId,
        date: event.date,
        imageUrl: event.imageUrl,
        status: event.status,
      });
    }

    setCache(cacheKey, results);
    return results;
  }

  async post(target, data) {
    if (!data.name) return { status: 400, headers: {}, data: { error: 'name is required' } };
    if (!data.venueId) return { status: 400, headers: {}, data: { error: 'venueId is required' } };
    if (!data.date) return { status: 400, headers: {}, data: { error: 'date is required' } };
    if (!data.category) return { status: 400, headers: {}, data: { error: 'category is required' } };

    const venue = await tables.Venue.get(data.venueId);
    if (!venue) return { status: 404, headers: {}, data: { error: 'Venue not found' } };

    if (!data.status) data.status = 'on_sale';
    if (!data.id) data.id = crypto.randomUUID();
    invalidateCache('events:');
    await tables.Event.put(data);
    return await tables.Event.get(data.id) || data;
  }

  async put(target, data) {
    invalidateCache('events:');
    return tables.Event.put({ id: target.id, ...data });
  }

  async patch(target, data) {
    invalidateCache('events:');
    return tables.Event.patch(target.id, data);
  }

  async delete(target) {
    invalidateCache('events:');
    return tables.Event.delete(target.id);
  }
}

// ── Seat Resource ─────────────────────────────────────────────────
// Individual seat tracking with hold mechanism and lazy expiry.
export class Seat extends tables.Seat {
  static loadAsInstance = false;

  async get(target) {
    const context = this.getContext();
    const url = context?.url || '';

    // GET /Seat/:id/hold — hold a seat
    if (target.id && url.includes('/hold')) {
      return { status: 405, headers: {}, data: { error: 'Use POST to hold seats' } };
    }

    // Single seat
    if (target.id) {
      const seat = await tables.Seat.get(target.id);
      if (!seat) return { status: 404, headers: {}, data: { error: 'Seat not found' } };
      return expireHoldIfNeeded(seat);
    }

    // List seats — filter by eventId, sectionId
    const eventId = target.get ? target.get('eventId') : null;
    const sectionId = target.get ? target.get('sectionId') : null;
    const statusFilter = target.get ? target.get('status') : null;

    if (!eventId) {
      return { status: 400, headers: {}, data: { error: 'eventId query parameter is required' } };
    }

    const conditions = [{ attribute: 'eventId', value: eventId }];
    if (sectionId) conditions.push({ attribute: 'sectionId', value: sectionId });

    const results = [];
    for await (const seat of tables.Seat.search({ conditions })) {
      const resolved = await expireHoldIfNeeded(seat);
      if (statusFilter && resolved.status !== statusFilter) continue;
      results.push(resolved);
    }
    return results;
  }

  async post(target, data) {
    // POST /Seat/ with action field for hold/release operations
    if (data.action === 'hold') {
      return this.holdSeats(data);
    }
    if (data.action === 'release') {
      return this.releaseSeats(data);
    }

    // Standard seat creation (for seeding)
    if (!data.eventId || !data.sectionId || !data.row || data.seatNumber === undefined) {
      return { status: 400, headers: {}, data: { error: 'eventId, sectionId, row, and seatNumber are required' } };
    }
    if (!data.status) data.status = 'available';
    if (!data.id) data.id = crypto.randomUUID();
    await tables.Seat.put(data);
    return await tables.Seat.get(data.id) || data;
  }

  async holdSeats(data) {
    const { seatIds, userId, eventId } = data;
    if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
      return { status: 400, headers: {}, data: { error: 'seatIds array is required' } };
    }
    if (!userId) {
      return { status: 400, headers: {}, data: { error: 'userId is required' } };
    }

    const holdExpiry = Date.now() + HOLD_DURATION_MS;
    const held = [];
    const failed = [];

    for (const seatId of seatIds) {
      const seat = await tables.Seat.get(seatId);
      if (!seat) {
        failed.push({ seatId, reason: 'Seat not found' });
        continue;
      }

      // Lazy expiry check
      const resolved = await expireHoldIfNeeded(seat);

      // NOTE: Harper does not have atomic conditional writes.
      // This read-check-write is vulnerable to TOCTOU race conditions.
      // This is acknowledged as a platform limitation. In a high-concurrency
      // production system, an external locking mechanism would be needed.
      if (resolved.status !== 'available') {
        failed.push({ seatId, reason: `Seat is ${resolved.status}` });
        continue;
      }

      await tables.Seat.patch(seatId, {
        status: 'held',
        holdExpiry,
        holderId: userId,
      });
      held.push(seatId);
    }

    if (held.length === 0) {
      return { status: 409, headers: {}, data: { error: 'No seats could be held', failed } };
    }

    invalidateCache('events:');
    return {
      held,
      failed,
      holdExpiry,
      expiresIn: HOLD_DURATION_MS / 1000,
    };
  }

  async releaseSeats(data) {
    const { seatIds, userId } = data;
    if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
      return { status: 400, headers: {}, data: { error: 'seatIds array is required' } };
    }

    const released = [];
    const failed = [];

    for (const seatId of seatIds) {
      const seat = await tables.Seat.get(seatId);
      if (!seat) {
        failed.push({ seatId, reason: 'Seat not found' });
        continue;
      }

      if (seat.status !== 'held') {
        failed.push({ seatId, reason: `Seat is ${seat.status}, not held` });
        continue;
      }

      if (userId && seat.holderId !== userId) {
        failed.push({ seatId, reason: 'Seat held by another user' });
        continue;
      }

      await tables.Seat.patch(seatId, {
        status: 'available',
        holdExpiry: null,
        holderId: null,
      });
      released.push(seatId);

      // Notify waitlist when seats released
      notifyWaitlist(seat.eventId, seatId, seat.sectionId).catch(() => {});
    }

    invalidateCache('events:');
    return { released, failed };
  }
}

// ── Purchase Resource ─────────────────────────────────────────────
// Checkout: validates holds belong to user, marks seats sold, creates purchase.
export class Purchase extends tables.Purchase {
  static loadAsInstance = false;

  async get(target) {
    if (target.id) {
      const purchase = await tables.Purchase.get(target.id);
      if (!purchase) return { status: 404, headers: {}, data: { error: 'Purchase not found' } };
      return purchase;
    }

    // List purchases by userId
    const userId = target.get ? target.get('userId') : null;
    const eventId = target.get ? target.get('eventId') : null;

    const conditions = [];
    if (userId) conditions.push({ attribute: 'userId', value: userId });
    if (eventId) conditions.push({ attribute: 'eventId', value: eventId });

    const results = [];
    for await (const p of tables.Purchase.search({
      conditions: conditions.length > 0 ? conditions : undefined,
    })) {
      results.push(p);
    }
    return results;
  }

  async post(target, data) {
    const { seatIds, userId, eventId } = data;
    if (!seatIds || !Array.isArray(seatIds) || seatIds.length === 0) {
      return { status: 400, headers: {}, data: { error: 'seatIds array is required' } };
    }
    if (!userId) {
      return { status: 400, headers: {}, data: { error: 'userId is required' } };
    }
    if (!eventId) {
      return { status: 400, headers: {}, data: { error: 'eventId is required' } };
    }

    // Validate all seats are held by this user
    let totalPriceInCents = 0;
    const seatsToComplete = [];

    for (const seatId of seatIds) {
      const seat = await tables.Seat.get(seatId);
      if (!seat) {
        return { status: 404, headers: {}, data: { error: `Seat ${seatId} not found` } };
      }

      // Lazy expiry — if hold expired, seat is no longer ours
      const resolved = await expireHoldIfNeeded(seat);

      // NOTE: Harper does not have atomic conditional writes.
      // This read-check-write pattern is vulnerable to TOCTOU race conditions.
      // Acknowledged as a platform limitation.
      if (resolved.status !== 'held') {
        return { status: 409, headers: {}, data: { error: `Seat ${seatId} is not held (status: ${resolved.status})` } };
      }

      if (resolved.holderId !== userId) {
        return { status: 403, headers: {}, data: { error: `Seat ${seatId} is held by another user` } };
      }

      if (resolved.holdExpiry < Date.now()) {
        return { status: 410, headers: {}, data: { error: `Hold on seat ${seatId} has expired` } };
      }

      // Look up section price
      const section = await tables.Section.get(seat.sectionId);
      if (section) totalPriceInCents += section.priceInCents;

      seatsToComplete.push(seat);
    }

    // Create the purchase record
    const purchaseId = crypto.randomUUID();
    const purchaseData = {
      id: purchaseId,
      eventId,
      userId,
      seatIds,
      totalPriceInCents,
      status: 'completed',
    };
    await tables.Purchase.put(purchaseData);

    // Mark all seats as sold
    for (const seat of seatsToComplete) {
      await tables.Seat.patch(seat.id, {
        status: 'sold',
        holdExpiry: null,
        purchaseId,
      });
    }

    invalidateCache('events:');

    // Check if event is now sold out
    this.checkSoldOut(eventId).catch(() => {});

    // Return the created purchase (put returns void, so return data directly)
    const created = await tables.Purchase.get(purchaseId);
    return created || purchaseData;
  }

  async checkSoldOut(eventId) {
    let hasAvailable = false;
    for await (const seat of tables.Seat.search({
      conditions: [
        { attribute: 'eventId', value: eventId },
        { attribute: 'status', value: 'available' },
      ],
      limit: 1,
    })) {
      hasAvailable = true;
      break;
    }

    if (!hasAvailable) {
      // Also check for expired holds
      for await (const seat of tables.Seat.search({
        conditions: [
          { attribute: 'eventId', value: eventId },
          { attribute: 'status', value: 'held' },
        ],
        limit: 1,
      })) {
        const resolved = await expireHoldIfNeeded(seat);
        if (resolved.status === 'available') {
          hasAvailable = true;
          break;
        }
      }
    }

    if (!hasAvailable) {
      await tables.Event.patch(eventId, { status: 'sold_out' });
      invalidateCache('events:');
    }
  }
}

// ── Waitlist Resource ─────────────────────────────────────────────
// Users join waitlist when event is sold out. Notified via MQTT when seats open.
export class Waitlist extends tables.Waitlist {
  static loadAsInstance = false;

  async get(target) {
    if (target.id) {
      const entry = await tables.Waitlist.get(target.id);
      if (!entry) return { status: 404, headers: {}, data: { error: 'Waitlist entry not found' } };
      return entry;
    }

    const eventId = target.get ? target.get('eventId') : null;
    const userId = target.get ? target.get('userId') : null;

    const conditions = [];
    if (eventId) conditions.push({ attribute: 'eventId', value: eventId });
    if (userId) conditions.push({ attribute: 'userId', value: userId });

    const results = [];
    for await (const entry of tables.Waitlist.search({
      conditions: conditions.length > 0 ? conditions : undefined,
    })) {
      results.push(entry);
    }
    return results;
  }

  async post(target, data) {
    if (!data.eventId) return { status: 400, headers: {}, data: { error: 'eventId is required' } };
    if (!data.userId) return { status: 400, headers: {}, data: { error: 'userId is required' } };

    // Check if event exists
    const event = await tables.Event.get(data.eventId);
    if (!event) return { status: 404, headers: {}, data: { error: 'Event not found' } };

    // Check if already on waitlist
    for await (const existing of tables.Waitlist.search({
      conditions: [
        { attribute: 'eventId', value: data.eventId },
        { attribute: 'userId', value: data.userId },
      ],
      limit: 1,
    })) {
      return { status: 409, headers: {}, data: { error: 'Already on waitlist', waitlistEntry: existing } };
    }

    if (data.notified === undefined) data.notified = false;
    if (!data.id) data.id = crypto.randomUUID();
    await tables.Waitlist.put(data);
    const entry = await tables.Waitlist.get(data.id) || data;

    // Publish MQTT notification for this event's waitlist
    try {
      await tables.Waitlist.publish(`waitlist/event/${data.eventId}`, {
        type: 'waitlist_joined',
        eventId: data.eventId,
        userId: data.userId,
        timestamp: Date.now(),
      });
    } catch (e) {
      // MQTT publish is best-effort
    }

    return entry;
  }
}
