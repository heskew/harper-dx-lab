// Event Ticketing System — Tier 6 Test Suite
// Tests: data model, seat inventory, holds, expiry, browse, detail, waitlist, concurrent safety, caching

const REST_URL = process.env.HARPER_URL || 'http://localhost:9926';
const AUTH = 'Basic ' + Buffer.from('admin:password').toString('base64');

let pass = 0;
let fail = 0;

function assert(condition, label) {
	if (condition) {
		pass++;
		console.log(`  PASS: ${label}`);
	} else {
		fail++;
		console.log(`  FAIL: ${label}`);
	}
}

async function rest(method, path, body, headers = {}) {
	const opts = {
		method,
		headers: {
			Authorization: AUTH,
			'Content-Type': 'application/json',
			...headers,
		},
	};
	if (body) opts.body = JSON.stringify(body);
	const res = await fetch(`${REST_URL}${path}`, opts);
	const text = await res.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { status: res.status, headers: res.headers, data };
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
	console.log(`Testing event ticketing system at ${REST_URL}\n`);

	// ===== SETUP: Seed data =====
	console.log('--- Setup: Seed venue, sections, event, seats ---');

	// Create venue
	await rest('POST', '/Venue/', {
		id: 'venue-1',
		name: 'Madison Square Garden',
		address: '4 Pennsylvania Plaza',
		city: 'New York',
		capacity: 20000,
	});

	// Create sections
	await rest('POST', '/Section/', {
		id: 'sec-floor',
		venueId: 'venue-1',
		name: 'Floor',
		rows: 5,
		seatsPerRow: 10,
		price: 250.0,
	});
	await rest('POST', '/Section/', {
		id: 'sec-balcony',
		venueId: 'venue-1',
		name: 'Balcony',
		rows: 10,
		seatsPerRow: 20,
		price: 75.0,
	});

	// Create a second venue for filtering tests
	await rest('POST', '/Venue/', {
		id: 'venue-2',
		name: 'The Fillmore',
		address: '1805 Geary Blvd',
		city: 'San Francisco',
		capacity: 1150,
	});

	// Create events
	const futureDate = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days out
	const farFuture = Date.now() + 90 * 24 * 60 * 60 * 1000; // 90 days out

	await rest('POST', '/Event/', {
		id: 'evt-concert',
		name: 'Rock Concert 2026',
		description: 'The biggest rock show of the year',
		category: 'music',
		venueId: 'venue-1',
		date: futureDate,
		status: 'upcoming',
	});
	await rest('POST', '/Event/', {
		id: 'evt-comedy',
		name: 'Comedy Night',
		description: 'Stand-up comedy show',
		category: 'comedy',
		venueId: 'venue-2',
		date: farFuture,
		status: 'upcoming',
	});
	await rest('POST', '/Event/', {
		id: 'evt-sports',
		name: 'Championship Game',
		description: 'Season finale',
		category: 'sports',
		venueId: 'venue-1',
		date: futureDate + 86400000,
		status: 'upcoming',
	});

	// Create individual seats for the concert event (Floor section)
	for (let row = 1; row <= 3; row++) {
		for (let num = 1; num <= 5; num++) {
			await rest('POST', '/Seat/', {
				id: `seat-floor-${row}-${num}`,
				sectionId: 'sec-floor',
				eventId: 'evt-concert',
				row,
				number: num,
				status: 'available',
			});
		}
	}

	// Create seats for balcony section
	for (let row = 1; row <= 2; row++) {
		for (let num = 1; num <= 5; num++) {
			await rest('POST', '/Seat/', {
				id: `seat-balc-${row}-${num}`,
				sectionId: 'sec-balcony',
				eventId: 'evt-concert',
				row,
				number: num,
				status: 'available',
			});
		}
	}

	console.log('  Seeded 2 venues, 2 sections, 3 events, 25 seats\n');

	// ===== TEST 1: Data model — events, venues, sections, seats, purchases =====
	console.log('--- Test 1: Data model handles all entity types ---');
	const v1 = await rest('GET', '/Venue/venue-1');
	assert(v1.status === 200 && v1.data.name === 'Madison Square Garden', 'Venue exists');
	const s1 = await rest('GET', '/Section/sec-floor');
	assert(s1.status === 200 && s1.data.price === 250.0, 'Section exists with pricing');
	const e1 = await rest('GET', '/Event/evt-concert');
	assert(e1.status === 200 && e1.data.name === 'Rock Concert 2026', 'Event exists');
	const seat1 = await rest('GET', '/Seat/seat-floor-1-1');
	assert(seat1.status === 200 && seat1.data.status === 'available', 'Individual seat tracked');

	// ===== TEST 2: Seat inventory is individually tracked =====
	console.log('--- Test 2: Individual seat tracking ---');
	const allFloorSeats = await rest('GET', '/Seat/?eventId=evt-concert&sectionId=sec-floor');
	assert(allFloorSeats.status === 200 && Array.isArray(allFloorSeats.data), 'Can query seats by event+section');
	assert(allFloorSeats.data.length === 15, `Floor has 15 individual seats (got ${allFloorSeats.data.length})`);
	const allAvailable = allFloorSeats.data.every(s => s.status === 'available');
	assert(allAvailable, 'All floor seats start as available');

	// ===== TEST 3: Seat hold mechanism =====
	console.log('--- Test 3: Seat hold with timeout ---');
	const holdRes = await rest('POST', '/Hold/', {
		id: 'hold-test-1',
		eventId: 'evt-concert',
		seatIds: ['seat-floor-1-1', 'seat-floor-1-2'],
		userId: 'user-alice',
	});
	assert(holdRes.status === 200, 'Hold created (200)');
	assert(holdRes.data.status === 'active', 'Hold is active');
	assert(holdRes.data.expiresAt > Date.now(), 'Hold has future expiry');

	// Verify seats are now held
	const heldSeat = await rest('GET', '/Seat/seat-floor-1-1');
	assert(heldSeat.data.status === 'held', 'Seat status changed to held');
	assert(heldSeat.data.holdId === 'hold-test-1', 'Seat references the hold');

	// ===== TEST 4: Hold expiry — simulate with short timeout =====
	console.log('--- Test 4: Hold expiry releases seats ---');
	// Create a hold that we'll manually expire
	const holdRes2 = await rest('POST', '/Hold/', {
		id: 'hold-expiry-test',
		eventId: 'evt-concert',
		seatIds: ['seat-floor-2-1'],
		userId: 'user-bob',
	});
	assert(holdRes2.status === 200, 'Second hold created');

	// Manually expire the hold by patching it directly
	const pastTime = Date.now() - 60000; // 1 minute ago
	await rest('PATCH', '/Hold/hold-expiry-test', { expiresAt: pastTime });
	await rest('PATCH', '/Seat/seat-floor-2-1', { holdExpiresAt: pastTime });
	await sleep(500); // Allow writes to settle

	// Now reading the seat should trigger expiry cleanup
	const expiredSeat = await rest('GET', '/Seat/seat-floor-2-1');
	assert(expiredSeat.data && expiredSeat.data.status === 'available', `Expired hold releases seat (got ${expiredSeat.data?.status})`);

	// ===== TEST 5: Browse API with filtering =====
	console.log('--- Test 5: Browse API with filtering ---');
	// Filter by category
	const musicEvents = await rest('GET', '/Event/?category=music');
	assert(musicEvents.status === 200, 'Browse by category returns 200');
	assert(Array.isArray(musicEvents.data) && musicEvents.data.length === 1, `Found 1 music event (got ${musicEvents.data?.length})`);
	assert(musicEvents.data[0].id === 'evt-concert', 'Music event is the concert');

	// Filter by venue
	const venueEvents = await rest('GET', `/Event/?venueId=venue-1`);
	assert(venueEvents.status === 200 && venueEvents.data.length === 2, `Found 2 events at venue-1 (got ${venueEvents.data?.length})`);

	// Filter by date range
	const dateFilterEvents = await rest('GET', `/Event/?dateFrom=${futureDate - 1000}&dateTo=${futureDate + 1000}`);
	assert(dateFilterEvents.status === 200 && dateFilterEvents.data.length === 1, `Date range filter works (got ${dateFilterEvents.data?.length})`);

	// ===== TEST 6: Event detail with availability by section and pricing =====
	console.log('--- Test 6: Event detail with sections, availability, pricing ---');
	const detail = await rest('GET', '/Event/evt-concert');
	assert(detail.status === 200, 'Event detail returns 200');
	assert(detail.data.venue && detail.data.venue.name === 'Madison Square Garden', 'Detail includes venue info');
	assert(Array.isArray(detail.data.sections), 'Detail includes sections array');
	assert(detail.data.sections.length === 2, `Has 2 sections (got ${detail.data.sections?.length})`);

	const floorSection = detail.data.sections.find(s => s.name === 'Floor');
	assert(floorSection && floorSection.price === 250.0, 'Floor section has correct price');
	assert(floorSection && floorSection.totalSeats === 15, `Floor has 15 total seats (got ${floorSection?.totalSeats})`);
	// 2 seats held by hold-test-1, 1 seat was expired → available
	assert(floorSection && floorSection.availableSeats === 13, `Floor has 13 available seats (got ${floorSection?.availableSeats})`);

	const balcSection = detail.data.sections.find(s => s.name === 'Balcony');
	assert(balcSection && balcSection.price === 75.0, 'Balcony section has correct price');
	assert(balcSection && balcSection.availableSeats === 10, `Balcony has 10 available (got ${balcSection?.availableSeats})`);

	// ===== TEST 7: Waitlist — join and query =====
	console.log('--- Test 7: Waitlist functionality ---');
	const wlRes = await rest('POST', '/Waitlist/', {
		id: 'wl-test-1',
		eventId: 'evt-concert',
		userId: 'user-charlie',
		sectionId: 'sec-floor',
	});
	assert(wlRes.status === 200, 'Waitlist entry created (200)');
	assert(wlRes.data.status === 'waiting', 'Waitlist status is waiting');
	assert(wlRes.data.mqttTopic === 'ticketing/events/evt-concert/waitlist', 'MQTT topic returned');

	// Can't join twice
	const wlDup = await rest('POST', '/Waitlist/', {
		eventId: 'evt-concert',
		userId: 'user-charlie',
		sectionId: 'sec-floor',
	});
	assert(wlDup.status === 409, `Duplicate waitlist entry rejected (${wlDup.status})`);

	// Query waitlist by event
	const wlQuery = await rest('GET', '/Waitlist/?eventId=evt-concert');
	assert(wlQuery.status === 200 && wlQuery.data.length >= 1, 'Can query waitlist by event');

	// ===== TEST 8: Waitlist notification on seat release =====
	console.log('--- Test 8: Waitlist notification on seat release ---');
	// Create a hold, then cancel it — should notify waitlist
	const holdForCancel = await rest('POST', '/Hold/', {
		id: 'hold-cancel-test',
		eventId: 'evt-concert',
		seatIds: ['seat-floor-3-1'],
		userId: 'user-dave',
	});
	assert(holdForCancel.status === 200, 'Hold created for cancel test');

	// Cancel the hold
	const cancelRes = await rest('DELETE', '/Hold/hold-cancel-test');
	assert(cancelRes.status === 200, 'Hold cancelled');

	// Check that the seat is available again
	const cancelledSeat = await rest('GET', '/Seat/seat-floor-3-1');
	assert(cancelledSeat.data.status === 'available', 'Cancelled hold releases seat');

	// Check waitlist entry was notified
	const wlAfter = await rest('GET', '/Waitlist/wl-test-1');
	assert(wlAfter.data.status === 'notified', `Waitlist entry notified (got ${wlAfter.data.status})`);
	assert(wlAfter.data.notifiedAt > 0, 'Notification timestamp set');

	// ===== TEST 9: Concurrent checkout safety =====
	console.log('--- Test 9: Concurrent checkout safety ---');
	// Two users try to hold the same seat simultaneously
	const [concHold1, concHold2] = await Promise.all([
		rest('POST', '/Hold/', {
			id: 'hold-conc-1',
			eventId: 'evt-concert',
			seatIds: ['seat-balc-1-1'],
			userId: 'user-eve',
		}),
		rest('POST', '/Hold/', {
			id: 'hold-conc-2',
			eventId: 'evt-concert',
			seatIds: ['seat-balc-1-1'],
			userId: 'user-frank',
		}),
	]);

	const neitherBothSucceeded = !(concHold1.status === 200 && concHold2.status === 200);

	assert(neitherBothSucceeded, `Both holds don't both succeed (${concHold1.status}, ${concHold2.status})`);
	assert(concHold1.status === 200 || concHold2.status === 200, `At least one hold succeeds (${concHold1.status}, ${concHold2.status})`);

	// ===== TEST 10: Purchase flow =====
	console.log('--- Test 10: Purchase completes checkout ---');
	// Use the hold from test 3
	const purchaseRes = await rest('POST', '/Purchase/', {
		id: 'purchase-test-1',
		holdId: 'hold-test-1',
		userId: 'user-alice',
	});
	assert(purchaseRes.status === 200, 'Purchase created (200)');
	assert(purchaseRes.data.status === 'confirmed', 'Purchase confirmed');
	assert(purchaseRes.data.totalPrice === 500.0, `Total price: $${purchaseRes.data.totalPrice} (2x $250)`);

	// Verify seats are now purchased
	const purchasedSeat = await rest('GET', '/Seat/seat-floor-1-1');
	assert(purchasedSeat.data.status === 'purchased', 'Seat status is purchased');
	assert(purchasedSeat.data.purchaseId === 'purchase-test-1', 'Seat references purchase');

	// ===== TEST 11: Cache strategy for browse =====
	console.log('--- Test 11: Browse caching with ETags ---');
	const browse1 = await rest('GET', '/Event/?category=music');
	const browseEtag = browse1.headers.get('etag');
	assert(browseEtag, `Browse returns ETag: ${browseEtag}`);
	const cacheControl = browse1.headers.get('cache-control');
	assert(cacheControl && cacheControl.includes('max-age'), `Browse returns Cache-Control: ${cacheControl}`);

	// Conditional request with same ETag
	const browse2 = await rest('GET', '/Event/?category=music', null, { 'If-None-Match': browseEtag });
	assert(browse2.status === 304, `Conditional browse returns 304 (got ${browse2.status})`);

	// Detail endpoint also has caching
	const detail2 = await rest('GET', '/Event/evt-concert');
	const detailEtag = detail2.headers.get('etag');
	assert(detailEtag, `Detail returns ETag: ${detailEtag}`);

	// ===== CLEANUP =====
	console.log('\n--- Cleanup ---');
	// Delete in reverse dependency order
	const tables = ['Purchase', 'Hold', 'Waitlist', 'Seat', 'Event', 'Section', 'Venue'];
	for (const table of tables) {
		const all = await rest('GET', `/${table}/`);
		if (Array.isArray(all.data)) {
			for (const item of all.data) {
				await rest('DELETE', `/${table}/${item.id}`);
			}
		}
	}
	console.log('  Cleaned up all test data');

	// ===== SUMMARY =====
	console.log(`\n==============================`);
	console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} assertions`);
	console.log(`==============================`);
	process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('Test error:', err);
	process.exit(1);
});
