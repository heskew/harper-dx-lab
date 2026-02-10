import crypto from 'crypto';

// Fields used for ETag computation — excludes viewCount and timestamps
// so view tracking doesn't invalidate the cache
function extractContentFields(product) {
	return {
		id: product.id,
		name: product.name,
		description: product.description,
		price: product.price,
		sku: product.sku,
		imageUrl: product.imageUrl,
		featured: product.featured,
		categoryId: product.categoryId,
	};
}

function computeETag(data) {
	let content;
	if (Array.isArray(data)) {
		content = data.map(extractContentFields);
	} else {
		content = extractContentFields(data);
	}
	const hash = crypto.createHash('md5').update(JSON.stringify(content)).digest('hex');
	return '"' + hash + '"';
}

const CARD_FIELDS = ['id', 'name', 'price', 'imageUrl', 'featured', 'categoryId'];

function toCardView(product) {
	const card = {};
	for (const field of CARD_FIELDS) {
		if (product[field] !== undefined) card[field] = product[field];
	}
	return card;
}

export class Product extends tables.Product {
	static loadAsInstance = false;

	async get(target) {
		const pathname = target.pathname || '';
		const parts = pathname.split('/').filter(Boolean);
		const lastPart = parts[parts.length - 1];

		// GET /Product/trending
		if (target.id === 'trending' || lastPart === 'trending') {
			return this.getTrending(target);
		}

		// GET /Product/{id}/related
		if (parts.length >= 2 && lastPart === 'related') {
			const productId = parts[parts.length - 2];
			return this.getRelated(productId);
		}

		// Extract custom query params (Harper treats unknown params as filters)
		const view = target.get('view');

		// Card view for collections — bypass super.get() to avoid param conflict
		if (view === 'card' && !target.id) {
			const products = [];
			for await (const p of tables.Product.search({
				conditions: [{ attribute: 'viewCount', comparator: 'greater_than_equal', value: 0 }],
			})) {
				products.push(toCardView(p));
			}
			return products;
		}

		// Remove custom params before passing to super.get()
		if (target.has('view')) target.delete('view');

		// Standard GET with ETag and sparse fieldset support
		const result = await super.get(target);
		const context = this.getContext();

		// Compute ETag from content fields (excludes viewCount/timestamps)
		const etag = computeETag(result);

		// Conditional request: If-None-Match
		const ifNoneMatch = context.headers.get('if-none-match');
		if (ifNoneMatch && ifNoneMatch === etag) {
			return { status: 304, headers: { 'ETag': etag } };
		}

		// Set ETag on response
		context.responseHeaders.set('ETag', etag);

		// Track view for single product GETs
		// Awaited to ensure it runs within the request context
		// (writes require context; the increment is fast so minimal latency)
		if (!Array.isArray(result) && result && result.id) {
			await this.trackView(result.id);
		}

		// Sparse fieldsets for single product: ?view=card
		if (view === 'card') {
			return toCardView(result);
		}

		return result;
	}

	async trackView(productId) {
		try {
			// Record view in ProductView table
			await tables.ProductView.put({ id: crypto.randomUUID(), productId });
			// Increment viewCount on product
			const product = await tables.Product.get(productId);
			if (product) {
				const updated = {
					id: product.id,
					name: product.name,
					description: product.description,
					price: product.price,
					sku: product.sku,
					imageUrl: product.imageUrl,
					featured: product.featured,
					categoryId: product.categoryId,
					viewCount: (product.viewCount || 0) + 1,
				};
				await tables.Product.put(updated);
			}
		} catch (e) {
			// Silently fail — view tracking must never break reads
		}
	}

	async getTrending(target) {
		const limit = parseInt(target.get('limit')) || 10;
		const products = [];
		for await (const p of tables.Product.search({
			conditions: [{ attribute: 'viewCount', comparator: 'greater_than_equal', value: 0 }],
		})) {
			products.push(p);
		}
		products.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
		return products.slice(0, limit);
	}

	async getRelated(productId) {
		const product = await tables.Product.get(productId);
		if (!product) {
			const error = new Error(`Product ${productId} not found`);
			error.statusCode = 404;
			throw error;
		}
		if (!product.categoryId) {
			return [];
		}
		const related = [];
		for await (const p of tables.Product.search({
			conditions: [{ attribute: 'categoryId', value: product.categoryId }],
		})) {
			if (p.id !== productId) {
				related.push(p);
			}
		}
		return related.slice(0, 10);
	}

	async post(target, data) {
		if (!data.name || (typeof data.name === 'string' && data.name.trim() === '')) {
			const error = new Error('name is required');
			error.statusCode = 400;
			throw error;
		}
		if (data.price === undefined || data.price === null) {
			const error = new Error('price is required');
			error.statusCode = 400;
			throw error;
		}
		if (data.categoryId) {
			const category = await tables.Category.get(data.categoryId);
			if (!category) {
				const error = new Error(`Category ${data.categoryId} not found`);
				error.statusCode = 404;
				throw error;
			}
		}
		if (data.viewCount === undefined) data.viewCount = 0;
		if (data.featured === undefined) data.featured = false;
		return super.post(target, data);
	}

	async put(target, data) {
		return super.put(target, data);
	}

	async patch(target, data) {
		return super.patch(target, data);
	}
}

export class Category extends tables.Category {
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
