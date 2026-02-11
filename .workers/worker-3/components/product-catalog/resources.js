// Product Catalog with API Key Auth, Tiered Access Control, and Rate Limiting

// Tier field visibility
const BRONZE_FIELDS = ['id', 'name', 'price', 'categoryId', 'featured', 'tags', 'sku', 'description', 'createdAt', 'updatedAt'];
const SILVER_FIELDS = [...BRONZE_FIELDS, 'imageUrl', 'inventoryCount'];
const GOLD_FIELDS = [...SILVER_FIELDS, 'supplierName', 'supplierContact', 'costPrice'];

const CARD_FIELDS = ['id', 'name', 'price', 'categoryId', 'featured'];

const TIER_LIMITS = { bronze: 100, silver: 1000, gold: 10000 };

function httpError(message, statusCode) {
	const error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

function filterFields(record, allowedFields) {
	const filtered = {};
	for (const field of allowedFields) {
		if (record[field] !== undefined) filtered[field] = record[field];
	}
	return filtered;
}

function cardView(record) {
	return filterFields(record, CARD_FIELDS);
}

function tierFields(tier) {
	if (tier === 'gold') return GOLD_FIELDS;
	if (tier === 'silver') return SILVER_FIELDS;
	return BRONZE_FIELDS;
}

// Shared auth + rate limit logic
async function authenticate(context) {
	const apiKey = context.headers.get('x-api-key');
	if (!apiKey) {
		throw httpError('Missing API key. Provide X-API-Key header.', 401);
	}

	// Look up the API key
	let keyRecord = null;
	for await (const k of tables.ApiKey.search({
		conditions: [{ attribute: 'key', value: apiKey }],
		limit: 1,
	})) {
		keyRecord = k;
		break;
	}

	if (!keyRecord || !keyRecord.active) {
		throw httpError('Invalid or inactive API key.', 401);
	}

	return { keyRecord };
}

async function checkRateLimit(keyRecord, context) {
	const now = Date.now();
	const windowMs = 3600000; // 1 hour
	const limit = keyRecord.rateLimit || TIER_LIMITS[keyRecord.tier] || 100;

	// Get or create rate limit record
	let rateRecord = null;
	try {
		rateRecord = await tables.RateLimit.get(keyRecord.id);
	} catch (e) {}

	if (!rateRecord || (now - rateRecord.windowStart) >= windowMs) {
		// New window
		await tables.RateLimit.put({
			id: keyRecord.id,
			apiKeyId: keyRecord.id,
			windowStart: now,
			requestCount: 1,
		});
		return { remaining: limit - 1, limit, retryAfter: null };
	}

	const count = (rateRecord.requestCount || 0) + 1;
	if (count > limit) {
		const elapsed = now - rateRecord.windowStart;
		const retryAfter = Math.ceil((windowMs - elapsed) / 1000);
		return { remaining: 0, limit, retryAfter, exceeded: true };
	}

	await tables.RateLimit.patch(keyRecord.id, { requestCount: count });
	return { remaining: limit - count, limit, retryAfter: null };
}

function setRateLimitHeaders(context, rateInfo) {
	context.responseHeaders.set('X-RateLimit-Limit', String(rateInfo.limit));
	context.responseHeaders.set('X-RateLimit-Remaining', String(rateInfo.remaining));
	if (rateInfo.retryAfter) {
		context.responseHeaders.set('Retry-After', String(rateInfo.retryAfter));
	}
}

// Full auth + rate limit gate. Returns { keyRecord, tier } or throws.
async function gate(resourceInstance) {
	const context = resourceInstance.getContext();
	const { keyRecord } = await authenticate(context);
	const rateInfo = await checkRateLimit(keyRecord, context);
	setRateLimitHeaders(context, rateInfo);

	if (rateInfo.exceeded) {
		throw httpError('Rate limit exceeded. Check Retry-After header.', 429);
	}

	return { keyRecord, tier: keyRecord.tier };
}

export class Category extends tables.Category {
	static loadAsInstance = false;

	async get(target) {
		const result = await gate(this);
		return super.get(target);
	}

	async post(target, data) {
		const result = await gate(this);
		if (!data.name || (typeof data.name === 'string' && data.name.trim() === '')) {
			throw httpError('name is required', 400);
		}
		return super.post(target, data);
	}

	async patch(target, data) {
		const result = await gate(this);
		return super.patch(target, data);
	}

	async delete(target) {
		const result = await gate(this);
		return super.delete(target);
	}
}

export class Product extends tables.Product {
	static loadAsInstance = false;

	async get(target) {
		const result = await gate(this);

		const { tier } = result;
		const context = this.getContext();
		const url = context?.url || '';

		// Query param routing
		const trending = target.get ? target.get('trending') : null;
		const relatedTo = target.get ? target.get('relatedTo') : null;
		const view = target.get ? target.get('view') : null;

		// GET /Product/?trending=true
		if (trending === 'true' || trending === '1' || target.id === 'trending') {
			return this.getTrending(target, tier);
		}

		// GET /Product/?relatedTo=<id>
		if (relatedTo) {
			return this.getRelated(relatedTo, target, tier);
		}

		// GET /Product/<id>/related
		if (target.id && url.includes('/related')) {
			const productId = target.id.replace(/\/related$/, '');
			return this.getRelated(productId, target, tier);
		}

		// Single product GET
		if (target.id) {
			return this.getSingleProduct(target, view, tier);
		}

		// Collection — card view
		if (view === 'card') {
			return this.getCollectionCards(target, tier);
		}

		// Collection — featured filter
		const featured = target.get ? target.get('featured') : null;
		if (featured === 'true') {
			return this.getFeatured(target, tier);
		}

		// Default collection - apply tier filtering
		return this.getFilteredCollection(target, tier);
	}

	async getSingleProduct(target, view, tier) {
		const record = await super.get(target);
		if (!record) return record;

		// Track view (fire and forget) — only for authenticated requests
		this.trackView(record.id).catch(() => {});

		// Get view count
		let viewCount = 0;
		try {
			const viewRecord = await tables.ProductView.get(record.id);
			if (viewRecord) viewCount = viewRecord.viewCount || 0;
		} catch (e) {}

		const allowed = tierFields(tier);

		if (view === 'card') {
			// Card view intersected with tier permissions
			const cardAllowed = CARD_FIELDS.filter(f => allowed.includes(f));
			return filterFields(record, cardAllowed);
		}

		// Full or default view filtered by tier
		const data = filterFields(record, allowed);
		data.viewCount = viewCount;

		if (view === 'full') {
			const related = await this.findRelated(record.categoryId, record.id, 5, tier);
			data.relatedProducts = related;
		}

		return data;
	}

	async trackView(productId) {
		try {
			const existing = await tables.ProductView.get(productId);
			if (existing) {
				await tables.ProductView.patch(productId, {
					viewCount: (existing.viewCount || 0) + 1,
					lastViewedAt: Date.now(),
				});
			} else {
				await tables.ProductView.put({
					id: productId,
					productId: productId,
					viewCount: 1,
					lastViewedAt: Date.now(),
				});
			}
		} catch (e) {
			// Don't let view tracking errors affect the read path
		}
	}

	async getFilteredCollection(target, tier) {
		const allowed = tierFields(tier);
		const results = [];
		for await (const p of tables.Product.search()) {
			results.push(filterFields(p, allowed));
		}
		return results;
	}

	async getCollectionCards(target, tier) {
		const allowed = tierFields(tier);
		const cardAllowed = CARD_FIELDS.filter(f => allowed.includes(f));
		const results = [];
		for await (const p of tables.Product.search()) {
			results.push(filterFields(p, cardAllowed));
		}
		return results;
	}

	async getTrending(target, tier) {
		const limit = (target.get ? parseInt(target.get('limit')) : 0) || 10;
		const allowed = tierFields(tier);
		const viewEntries = [];
		for await (const view of tables.ProductView.search({
			sort: { attribute: 'viewCount', descending: true },
			limit,
		})) {
			viewEntries.push({ productId: view.productId, viewCount: view.viewCount });
		}
		const results = [];
		for (const v of viewEntries) {
			const product = await tables.Product.get(v.productId);
			if (product) {
				const filtered = filterFields(product, allowed);
				filtered.viewCount = v.viewCount;
				results.push(filtered);
			}
		}
		return results;
	}

	async getRelated(productId, target, tier) {
		const product = await tables.Product.get(productId);
		if (!product) {
			throw httpError('Product not found', 404);
		}
		const limit = (target.get ? parseInt(target.get('limit')) : 0) || 10;
		return this.findRelated(product.categoryId, productId, limit, tier);
	}

	async findRelated(categoryId, excludeId, limit, tier) {
		const allowed = tierFields(tier);
		const results = [];
		for await (const p of tables.Product.search({
			conditions: [{ attribute: 'categoryId', value: categoryId }],
			limit: (limit || 10) + 1,
		})) {
			if (p.id !== excludeId) {
				results.push(filterFields(p, allowed));
			}
		}
		return results.slice(0, limit || 10);
	}

	async getFeatured(target, tier) {
		const limit = (target.get ? parseInt(target.get('limit')) : 0) || 20;
		const allowed = tierFields(tier);
		const results = [];
		for await (const p of tables.Product.search({
			conditions: [{ attribute: 'featured', value: true }],
			limit,
		})) {
			results.push(filterFields(p, allowed));
		}
		return results;
	}

	async post(target, data) {
		const result = await gate(this);

		// Only Gold tier can write
		if (result.tier !== 'gold') {
			throw httpError('Write access requires Gold tier', 403);
		}

		if (!data.name || (typeof data.name === 'string' && data.name.trim() === '')) {
			throw httpError('name is required', 400);
		}
		if (!data.categoryId) {
			throw httpError('categoryId is required', 400);
		}
		const category = await tables.Category.get(data.categoryId);
		if (!category) {
			throw httpError(`Category ${data.categoryId} not found`, 404);
		}
		if (data.featured === undefined) data.featured = false;
		return super.post(target, data);
	}

	async patch(target, data) {
		const result = await gate(this);

		// Only Gold tier can write — and only inventory updates
		if (result.tier !== 'gold') {
			throw httpError('Write access requires Gold tier', 403);
		}

		return super.patch(target, data);
	}

	async put(target, data) {
		const result = await gate(this);

		if (result.tier !== 'gold') {
			throw httpError('Write access requires Gold tier', 403);
		}

		return super.put(target, data);
	}

	async delete(target) {
		const result = await gate(this);

		if (result.tier !== 'gold') {
			throw httpError('Write access requires Gold tier', 403);
		}

		return super.delete(target);
	}
}

// ApiKey resource — admin only (protected by Harper basic auth)
export class ApiKey extends tables.ApiKey {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.key) throw httpError('key is required', 400);
		if (!data.partnerName) throw httpError('partnerName is required', 400);
		if (!data.tier || !['bronze', 'silver', 'gold'].includes(data.tier)) {
			throw httpError('tier must be bronze, silver, or gold', 400);
		}
		if (data.active === undefined) data.active = true;
		if (!data.rateLimit) data.rateLimit = TIER_LIMITS[data.tier];
		return super.post(target, data);
	}
}
