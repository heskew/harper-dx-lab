// Event Ticketing System — Harper Component

const HOLD_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// In-memory cache for browse/listing results
const listingCache = new Map();
const LISTING_CACHE_TTL = 60_000; // 60 seconds

function getCached(key) {
  const entry = listingCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    listingCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data, ttl = LISTING_CACHE_TTL) {
  listingCache.set(key, { data, expiresAt: Date.now() + ttl });
}

// Harper .get() returns proxy records; convert to plain objects for spreading
function toPlain(record) {
  if (!record) return record;
  return JSON.parse(JSON.stringify(record));
}

// ── Hold expiry helpers ─────────────────────────────────────────

function isHoldExpired(hold) {
  return hold.status === 'active' && Date.now() > hold.expiresAt;
}

async function expireHold(hold) {
  await tables.SeatHold.patch(hold.id, { status: 'expired' });

  if (hold.seatIds) {
    for (const seatId of hold.seatIds) {
      const seat = toPlain(await tables.EventSeat.get(seatId));
      if (seat && seat.status === 'held' && seat.holdId === hold.id) {
        await tables.EventSeat.patch(seatId, { status: 'available', holdId: null });
      }
    }
  }

  // Notify waitlist subscribers via MQTT
  await notifyWaitlist(hold.eventId, hold.seatIds);
}

async function notifyWaitlist(eventId, releasedSeatIds) {
  const entries = [];
  for await (const entry of await tables.WaitlistEntry.search({
    conditions: [
      { attribute: 'eventId', value: eventId },
      { attribute: 'status', value: 'waiting' },
    ],
  })) {
    entries.push(entry);
  }

  if (entries.length > 0) {
    await tables.WaitlistEntry.publish(`waitlist/${eventId}`, {
      eventId,
      releasedSeatIds,
      message: 'Seats are now available!',
      waitlistSize: entries.length,
      timestamp: Date.now(),
    });
  }
}

// Lazy expiry: resolve effective seat status, expiring stale holds on read
async function getEffectiveSeatStatus(seat) {
  if (seat.status !== 'held') return seat.status;
  if (seat.holdId) {
    const hold = toPlain(await tables.SeatHold.get(seat.holdId));
    if (hold && isHoldExpired(hold)) {
      await expireHold(hold);
      return 'available';
    }
  }
  return 'held';
}

// ── Event Resource ──────────────────────────────────────────────
export class Event extends tables.Event {
  static loadAsInstance = false;

  async get(query) {
    const context = this.getContext();

    // Single event — detail with section availability
    if (query.id) {
      const event = toPlain(await tables.Event.get(query.id));
      if (!event) return { status: 404, headers: {}, data: { error: 'Event not found' } };

      const venue = event.venueId ? toPlain(await tables.Venue.get(event.venueId)) : null;

      const sections = [];
      if (event.venueId) {
        for await (const s of await tables.Section.search({
          conditions: [{ attribute: 'venueId', value: event.venueId }],
        })) {
          sections.push(s);
        }
      }

      // Build per-section availability
      const sectionAvailability = [];
      for (const section of sections) {
        let available = 0;
        let held = 0;
        let sold = 0;
        let total = 0;

        for await (const seat of await tables.EventSeat.search({
          conditions: [
            { attribute: 'eventId', value: query.id },
            { attribute: 'sectionId', value: section.id },
          ],
        })) {
          total++;
          const eff = await getEffectiveSeatStatus(seat);
          if (eff === 'available') available++;
          else if (eff === 'held') held++;
          else if (eff === 'sold') sold++;
        }

        sectionAvailability.push({
          sectionId: section.id,
          sectionName: section.name,
          price: section.price,
          totalSeats: total,
          available,
          held,
          sold,
        });
      }

      context.responseHeaders.set('Cache-Control', 'public, max-age=30');

      return {
        ...event,
        venue,
        sections: sectionAvailability,
      };
    }

    // Browse / list events with filtering
    const category = context.headers.get('x-category');
    const venueId = context.headers.get('x-venue-id');
    const status = context.headers.get('x-status');
    const dateFrom = context.headers.get('x-date-from');
    const dateTo = context.headers.get('x-date-to');

    const cacheKey = `events:${category || ''}:${venueId || ''}:${status || ''}:${dateFrom || ''}:${dateTo || ''}`;
    const cached = getCached(cacheKey);
    if (cached) {
      context.responseHeaders.set('Cache-Control', 'public, max-age=60');
      context.responseHeaders.set('X-Cache', 'HIT');
      return cached;
    }

    const conditions = [];
    if (category) conditions.push({ attribute: 'category', value: category });
    if (venueId) conditions.push({ attribute: 'venueId', value: venueId });
    if (status) conditions.push({ attribute: 'status', value: status });

    const events = [];
    const searchOpts = conditions.length > 0 ? { conditions } : {};
    for await (const e of await tables.Event.search(searchOpts)) {
      events.push(e);
    }

    // Client-side date range filtering
    let filtered = events;
    if (dateFrom) {
      const from = parseFloat(dateFrom);
      filtered = filtered.filter(e => e.date >= from);
    }
    if (dateTo) {
      const to = parseFloat(dateTo);
      filtered = filtered.filter(e => e.date <= to);
    }

    filtered.sort((a, b) => a.date - b.date);

    setCache(cacheKey, filtered);
    context.responseHeaders.set('Cache-Control', 'public, max-age=60');
    context.responseHeaders.set('X-Cache', 'MISS');

    return filtered;
  }

  async post(target, data) {
    data.status = data.status || 'on_sale';
    const venueId = data.venueId;

    // Create event via base table
    const result = await tables.Event.post(data);
    const eventId = typeof result === 'string' ? result : (result && result.id ? result.id : String(result));

    // Initialize individual seats for every section of the venue (fire-and-forget
    // to avoid blocking the response; the seat creation runs in the background)
    if (venueId && eventId) {
      const initSeats = async () => {
        try {
          const sections = [];
          for await (const s of await tables.Section.search({
            conditions: [{ attribute: 'venueId', value: venueId }],
          })) {
            sections.push(s);
          }
          for (const section of sections) {
            for (let row = 1; row <= section.rowCount; row++) {
              for (let seat = 1; seat <= section.seatsPerRow; seat++) {
                await tables.EventSeat.post({
                  eventId,
                  sectionId: section.id,
                  row,
                  seatNumber: seat,
                  status: 'available',
                  price: section.price,
                });
              }
            }
          }
        } catch (e) { /* seat init error logged silently */ }
      };
      // Await seat initialization so seats are ready when response is returned
      await initSeats();
    }

    listingCache.clear();

    return toPlain(await tables.Event.get(eventId));
  }

  async put(target, data) {
    listingCache.clear();
    return tables.Event.put({ id: target.id, ...data });
  }

  async patch(target, data) {
    listingCache.clear();
    return tables.Event.patch(target.id, data);
  }

  async delete(target) {
    listingCache.clear();
    return tables.Event.delete(target.id);
  }
}

// ── Venue Resource ──────────────────────────────────────────────
export class Venue extends tables.Venue {
  static loadAsInstance = false;

  async get(query) {
    const context = this.getContext();

    if (query.id) {
      const venue = toPlain(await tables.Venue.get(query.id));
      if (!venue) return { status: 404, headers: {}, data: { error: 'Venue not found' } };

      const sections = [];
      for await (const s of await tables.Section.search({
        conditions: [{ attribute: 'venueId', value: query.id }],
      })) {
        sections.push(s);
      }

      return { ...venue, sections };
    }

    const venues = [];
    for await (const v of await tables.Venue.search({})) {
      venues.push(v);
    }

    context.responseHeaders.set('Cache-Control', 'public, max-age=120');
    return venues;
  }

  async post(target, data) {
    return tables.Venue.post(data);
  }

  async put(target, data) {
    return tables.Venue.put({ id: target.id, ...data });
  }

  async patch(target, data) {
    return tables.Venue.patch(target.id, data);
  }

  async delete(target) {
    return tables.Venue.delete(target.id);
  }
}

// ── Section Resource ────────────────────────────────────────────
export class Section extends tables.Section {
  static loadAsInstance = false;

  async get(query) {
    if (query.id) {
      const section = await tables.Section.get(query.id);
      if (!section) return { status: 404, headers: {}, data: { error: 'Section not found' } };
      return section;
    }

    const sections = [];
    for await (const s of await tables.Section.search({})) {
      sections.push(s);
    }
    return sections;
  }

  async post(target, data) {
    return tables.Section.post(data);
  }

  async put(target, data) {
    return tables.Section.put({ id: target.id, ...data });
  }

  async delete(target) {
    return tables.Section.delete(target.id);
  }
}

// ── EventSeat Resource ──────────────────────────────────────────
export class EventSeat extends tables.EventSeat {
  static loadAsInstance = false;

  async get(query) {
    const context = this.getContext();

    if (query.id) {
      const seat = toPlain(await tables.EventSeat.get(query.id));
      if (!seat) return { status: 404, headers: {}, data: { error: 'Seat not found' } };
      const effectiveStatus = await getEffectiveSeatStatus(seat);
      return { ...seat, status: effectiveStatus };
    }

    // Filter by event and/or section
    const eventId = context.headers.get('x-event-id');
    const sectionId = context.headers.get('x-section-id');

    const conditions = [];
    if (eventId) conditions.push({ attribute: 'eventId', value: eventId });
    if (sectionId) conditions.push({ attribute: 'sectionId', value: sectionId });

    const seats = [];
    const searchOpts = conditions.length > 0 ? { conditions } : {};
    for await (const s of await tables.EventSeat.search(searchOpts)) {
      const eff = await getEffectiveSeatStatus(s);
      seats.push({ ...s, status: eff });
    }

    context.responseHeaders.set('Cache-Control', 'public, max-age=10');
    return seats;
  }
}

// ── SeatHold Resource ───────────────────────────────────────────
export class SeatHold extends tables.SeatHold {
  static loadAsInstance = false;

  async get(query) {
    if (query.id) {
      const hold = toPlain(await tables.SeatHold.get(query.id));
      if (!hold) return { status: 404, headers: {}, data: { error: 'Hold not found' } };
      if (isHoldExpired(hold)) {
        await expireHold(hold);
        return { ...hold, status: 'expired' };
      }
      return hold;
    }

    const context = this.getContext();
    const userId = context.headers.get('x-user-id');

    const conditions = [{ attribute: 'status', value: 'active' }];
    if (userId) conditions.push({ attribute: 'userId', value: userId });

    const holds = [];
    for await (const h of await tables.SeatHold.search({ conditions })) {
      if (isHoldExpired(h)) {
        await expireHold(h);
      } else {
        holds.push(h);
      }
    }

    return holds;
  }

  async post(target, data) {
    const { eventId, userId, seatIds } = data;

    if (!eventId || !userId || !seatIds || !seatIds.length) {
      return { status: 400, headers: {}, data: { error: 'eventId, userId, and seatIds are required' } };
    }

    // Verify all requested seats are available.
    // NOTE: Harper does not have atomic conditional writes. A TOCTOU race window
    // exists where two concurrent requests could both read seats as 'available'
    // before either writes 'held'. This is a known platform limitation.
    const unavailable = [];
    for (const seatId of seatIds) {
      const seat = toPlain(await tables.EventSeat.get(seatId));
      if (!seat) {
        return { status: 404, headers: {}, data: { error: `Seat ${seatId} not found` } };
      }
      const eff = await getEffectiveSeatStatus(seat);
      if (eff !== 'available') {
        unavailable.push(seatId);
      }
    }

    if (unavailable.length > 0) {
      return { status: 409, headers: {}, data: { error: 'Seats unavailable', unavailable } };
    }

    // Create hold record
    const expiresAt = Date.now() + HOLD_DURATION_MS;
    const holdResult = await tables.SeatHold.post({
      eventId,
      userId,
      seatIds,
      expiresAt,
      status: 'active',
    });
    const holdId = typeof holdResult === 'string' ? holdResult : (holdResult && holdResult.id ? holdResult.id : String(holdResult));

    // Mark seats as held
    for (const seatId of seatIds) {
      await tables.EventSeat.patch(seatId, { status: 'held', holdId });
    }

    const context = this.getContext();
    context.responseHeaders.set('X-Hold-Expires', new Date(expiresAt).toISOString());

    return toPlain(await tables.SeatHold.get(holdId));
  }

  async delete(target) {
    const hold = toPlain(await tables.SeatHold.get(target.id));
    if (!hold) return { status: 404, headers: {}, data: { error: 'Hold not found' } };

    if (hold.status === 'active') {
      await expireHold(hold);
    }

    return { success: true };
  }
}

// ── Purchase Resource ───────────────────────────────────────────
export class Purchase extends tables.Purchase {
  static loadAsInstance = false;

  async get(query) {
    if (query.id) {
      const purchase = await tables.Purchase.get(query.id);
      if (!purchase) return { status: 404, headers: {}, data: { error: 'Purchase not found' } };
      return purchase;
    }

    const context = this.getContext();
    const userId = context.headers.get('x-user-id');

    const conditions = [];
    if (userId) conditions.push({ attribute: 'userId', value: userId });

    const purchases = [];
    const searchOpts = conditions.length > 0 ? { conditions } : {};
    for await (const p of await tables.Purchase.search(searchOpts)) {
      purchases.push(p);
    }

    return purchases;
  }

  async post(target, data) {
    const { holdId, userId } = data;

    if (!holdId || !userId) {
      return { status: 400, headers: {}, data: { error: 'holdId and userId are required' } };
    }

    // Verify hold
    const hold = toPlain(await tables.SeatHold.get(holdId));
    if (!hold) {
      return { status: 404, headers: {}, data: { error: 'Hold not found' } };
    }

    if (hold.userId !== userId) {
      return { status: 403, headers: {}, data: { error: 'Hold does not belong to this user' } };
    }

    if (isHoldExpired(hold)) {
      await expireHold(hold);
      return { status: 410, headers: {}, data: { error: 'Hold has expired' } };
    }

    if (hold.status !== 'active') {
      return { status: 409, headers: {}, data: { error: `Hold status is '${hold.status}', expected 'active'` } };
    }

    // Re-verify each seat is still held by this hold (concurrent safety check)
    for (const seatId of hold.seatIds) {
      const seat = toPlain(await tables.EventSeat.get(seatId));
      if (!seat || seat.status !== 'held' || seat.holdId !== hold.id) {
        return { status: 409, headers: {}, data: { error: `Seat ${seatId} is no longer held by this checkout` } };
      }
    }

    // Calculate total price
    let totalPrice = 0;
    for (const seatId of hold.seatIds) {
      const seat = toPlain(await tables.EventSeat.get(seatId));
      if (seat) totalPrice += seat.price || 0;
    }

    // Create purchase
    const purchaseResult = await tables.Purchase.post({
      eventId: hold.eventId,
      userId,
      seatIds: hold.seatIds,
      totalPrice,
      status: 'confirmed',
    });
    const purchaseId = typeof purchaseResult === 'string' ? purchaseResult : (purchaseResult && purchaseResult.id ? purchaseResult.id : String(purchaseResult));

    // Mark seats as sold
    for (const seatId of hold.seatIds) {
      await tables.EventSeat.patch(seatId, { status: 'sold', purchaseId, holdId: null });
    }

    // Complete hold
    await tables.SeatHold.patch(hold.id, { status: 'completed' });

    // Check if event is now sold out
    await checkAndUpdateEventStatus(hold.eventId);

    return toPlain(await tables.Purchase.get(purchaseId));
  }
}

// ── Helper: Update event status if sold out ─────────────────────
async function checkAndUpdateEventStatus(eventId) {
  for await (const seat of await tables.EventSeat.search({
    conditions: [{ attribute: 'eventId', value: eventId }],
  })) {
    const eff = await getEffectiveSeatStatus(seat);
    if (eff === 'available') return; // Still has availability
  }
  await tables.Event.patch(eventId, { status: 'sold_out' });
  listingCache.clear();
}

// ── WaitlistEntry Resource ──────────────────────────────────────
export class WaitlistEntry extends tables.WaitlistEntry {
  static loadAsInstance = false;

  async get(query) {
    if (query.id) {
      const entry = await tables.WaitlistEntry.get(query.id);
      if (!entry) return { status: 404, headers: {}, data: { error: 'Waitlist entry not found' } };
      return entry;
    }

    const context = this.getContext();
    const eventId = context.headers.get('x-event-id');
    const userId = context.headers.get('x-user-id');

    const conditions = [];
    if (eventId) conditions.push({ attribute: 'eventId', value: eventId });
    if (userId) conditions.push({ attribute: 'userId', value: userId });

    const entries = [];
    const searchOpts = conditions.length > 0 ? { conditions } : {};
    for await (const e of await tables.WaitlistEntry.search(searchOpts)) {
      entries.push(e);
    }

    return entries;
  }

  async post(target, data) {
    const { eventId, userId } = data;

    if (!eventId || !userId) {
      return { status: 400, headers: {}, data: { error: 'eventId and userId are required' } };
    }

    // Prevent duplicate waitlist entries
    const existing = [];
    for await (const e of await tables.WaitlistEntry.search({
      conditions: [
        { attribute: 'eventId', value: eventId },
        { attribute: 'userId', value: userId },
        { attribute: 'status', value: 'waiting' },
      ],
    })) {
      existing.push(e);
    }

    if (existing.length > 0) {
      return { status: 409, headers: {}, data: { error: 'Already on waitlist', entry: existing[0] } };
    }

    const entry = await tables.WaitlistEntry.post({
      eventId,
      userId,
      status: 'waiting',
    });

    return entry;
  }

  async delete(target) {
    const entry = await tables.WaitlistEntry.get(target.id);
    if (!entry) return { status: 404, headers: {}, data: { error: 'Waitlist entry not found' } };
    await tables.WaitlistEntry.patch(target.id, { status: 'cancelled' });
    return { success: true };
  }
}
