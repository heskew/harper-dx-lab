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

async function main() {
	console.log(`Testing product catalog at ${REST_URL}\n`);

	// === Pre-cleanup: remove leftovers from previous runs ===
	await rest('DELETE', '/ProductView/test-p1');
	await rest('DELETE', '/ProductView/test-p2');
	await rest('DELETE', '/ProductView/test-p3');
	await rest('DELETE', '/Product/test-p1');
	await rest('DELETE', '/Product/test-p2');
	await rest('DELETE', '/Product/test-p3');
	await rest('DELETE', '/Category/test-cat-1');
	await rest('DELETE', '/Category/test-cat-2');

	// === Setup: Create categories and products ===
	console.log('--- Setup: Seed data ---');
	await rest('POST', '/Category/', { id: 'test-cat-1', name: 'Electronics', description: 'Tech stuff' });
	await rest('POST', '/Category/', { id: 'test-cat-2', name: 'Books', description: 'Reading material' });
	await rest('POST', '/Product/', { id: 'test-p1', name: 'Laptop', price: 999.99, categoryId: 'test-cat-1', featured: true, description: 'A powerful laptop' });
	await rest('POST', '/Product/', { id: 'test-p2', name: 'Phone', price: 699.99, categoryId: 'test-cat-1', description: 'A smart phone' });
	await rest('POST', '/Product/', { id: 'test-p3', name: 'Novel', price: 12.99, categoryId: 'test-cat-2', description: 'A good read' });
	console.log('  Seeded 2 categories, 3 products\n');

	// === Test 1: ETag on GET ===
	console.log('--- Test 1: ETag header ---');
	const r1 = await rest('GET', '/Product/test-p1');
	assert(r1.status === 200, 'GET returns 200');
	const etag = r1.headers.get('etag');
	assert(etag && etag.startsWith('"'), `ETag present: ${etag}`);

	// === Test 2: Conditional GET returns 304 ===
	console.log('--- Test 2: Conditional GET (304) ---');
	const r2 = await rest('GET', '/Product/test-p1', null, { 'If-None-Match': etag });
	assert(r2.status === 304, `Conditional GET returns 304 (got ${r2.status})`);

	// === Test 3: Cache invalidation ===
	console.log('--- Test 3: Cache invalidation ---');
	await rest('PATCH', '/Product/test-p1', { price: 899.99 });
	const r3 = await rest('GET', '/Product/test-p1', null, { 'If-None-Match': etag });
	assert(r3.status === 200, `After update, old ETag returns 200 (got ${r3.status})`);
	const newEtag = r3.headers.get('etag');
	assert(newEtag !== etag, `New ETag differs from old: ${newEtag}`);

	// === Test 4: Sparse fieldsets — card view ===
	console.log('--- Test 4: Sparse fieldsets ---');
	const r4 = await rest('GET', '/Product/test-p1?view=card');
	assert(r4.status === 200, 'Card view returns 200');
	assert(r4.data.id && r4.data.name && r4.data.price, 'Card has id, name, price');
	assert(!r4.data.description && !r4.data.createdAt, 'Card omits description, timestamps');

	// === Test 5: Collection card view ===
	console.log('--- Test 5: Collection card view ---');
	const r5 = await rest('GET', '/Product/?view=card');
	assert(r5.status === 200, 'Collection card returns 200');
	assert(Array.isArray(r5.data), 'Returns array');
	if (Array.isArray(r5.data) && r5.data.length > 0) {
		assert(!r5.data[0].description, 'Collection cards omit description');
	}

	// === Test 6: Related products ===
	console.log('--- Test 6: Related products ---');
	const r6 = await rest('GET', '/Product/?relatedTo=test-p1');
	assert(r6.status === 200, 'Related returns 200');
	assert(Array.isArray(r6.data), 'Returns array');
	if (Array.isArray(r6.data)) {
		assert(r6.data.length > 0, `Found ${r6.data.length} related products`);
		assert(r6.data.every(p => p.categoryId === 'test-cat-1'), 'All related are same category');
		assert(r6.data.every(p => p.id !== 'test-p1'), 'Excludes self');
	}

	// === Test 7: View tracking ===
	console.log('--- Test 7: View tracking ---');
	const before = await rest('GET', '/Product/test-p3');
	const vcBefore = before.data.viewCount;
	await rest('GET', '/Product/test-p3');
	await rest('GET', '/Product/test-p3');
	const after = await rest('GET', '/Product/test-p3');
	const vcAfter = after.data.viewCount;
	assert(vcAfter > vcBefore, `viewCount incremented: ${vcBefore} -> ${vcAfter}`);

	// === Test 8: Trending products ===
	console.log('--- Test 8: Trending products ---');
	const r8 = await rest('GET', '/Product/?trending=true');
	assert(r8.status === 200, 'Trending returns 200');
	assert(Array.isArray(r8.data), 'Returns array');
	if (Array.isArray(r8.data) && r8.data.length >= 2) {
		assert(
			(r8.data[0].viewCount || 0) >= (r8.data[1].viewCount || 0),
			'Sorted by viewCount descending',
		);
	}

	// === Test 9: Validation ===
	console.log('--- Test 9: Validation ---');
	const r9a = await rest('POST', '/Product/', { name: '', price: 10 });
	assert(r9a.status === 400, `Empty name rejected (${r9a.status})`);
	const r9b = await rest('POST', '/Product/', { name: 'Test' });
	assert(r9b.status === 400, `Missing categoryId rejected (${r9b.status})`);
	const r9c = await rest('POST', '/Product/', { name: 'Test', price: 10, categoryId: 'nonexistent' });
	assert(r9c.status === 404, `Invalid categoryId rejected (${r9c.status})`);

	// === Cleanup ===
	await rest('DELETE', '/ProductView/test-p1');
	await rest('DELETE', '/ProductView/test-p2');
	await rest('DELETE', '/ProductView/test-p3');
	await rest('DELETE', '/Product/test-p1');
	await rest('DELETE', '/Product/test-p2');
	await rest('DELETE', '/Product/test-p3');
	await rest('DELETE', '/Category/test-cat-1');
	await rest('DELETE', '/Category/test-cat-2');

	// === Summary ===
	console.log(`\n==============================`);
	console.log(`Results: ${pass} passed, ${fail} failed out of ${pass + fail} assertions`);
	console.log(`==============================`);
	process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error('Test error:', err);
	process.exit(1);
});
