// Product Catalog with Caching, ETags, Sparse Fieldsets, View Tracking

const CARD_FIELDS = ['id', 'name', 'price', 'imageUrl', 'categoryId', 'featured'];

function cardView(record) {
	const card = {};
	for (const field of CARD_FIELDS) {
		if (record[field] !== undefined) card[field] = record[field];
	}
	return card;
}

function generateETag(record) {
	return `"${record.updatedAt || record.createdAt || Date.now()}"`;
}

function httpError(message, statusCode) {
	const error = new Error(message);
	error.statusCode = statusCode;
	return error;
}

export class Category extends tables.Category {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.name || (typeof data.name === 'string' && data.name.trim() === '')) {
			throw httpError('name is required', 400);
		}
		return super.post(target, data);
	}
}

export class Product extends tables.Product {
	static loadAsInstance = false;

	async get(target) {
		const trending = target.get('trending');
		const relatedTo = target.get('relatedTo');
		const view = target.get('view');

		// GET /Product/?trending=true&limit=10
		if (trending === 'true' || trending === '1') {
			return this.getTrending(target);
		}

		// GET /Product/?relatedTo=<productId>&limit=10
		if (relatedTo) {
			return this.getRelated(relatedTo, target);
		}

		// Single product by ID
		if (target.id) {
			return this.getSingleProduct(target, view);
		}

		// Collection requests
		const featured = target.get('featured');

		// When 'view' param is set, use search() to avoid Harper treating it as a filter
		if (view === 'card') {
			let results;
			if (featured === 'true') {
				results = await this.getFeatured(target);
			} else {
				results = [];
				for await (const p of tables.Product.search({ limit: 1000 })) {
					results.push(p);
				}
			}
			return results.map(cardView);
		}

		if (featured === 'true') {
			return this.getFeatured(target);
		}

		return super.get(target);
	}

	async getSingleProduct(target, view) {
		const context = this.getContext();
		const ifNoneMatch = context.headers?.get('if-none-match');

		const record = await super.get(target);
		if (!record) return record;

		// Compute ETag from the record's update timestamp
		const etag = generateETag(record);

		// Conditional request: return 304 if ETag matches
		if (ifNoneMatch && ifNoneMatch === etag) {
			return { status: 304, headers: { 'ETag': etag, 'Cache-Control': 'max-age=60, must-revalidate' } };
		}

		// Track view (awaited to ensure count is current, errors silenced)
		await this.trackView(record.id);

		// Get current view count
		const viewData = await tables.ProductView.get(record.id);
		const viewCount = viewData ? (viewData.viewCount || 0) : 0;

		// Sparse fieldsets
		let data;
		if (view === 'card') {
			data = cardView(record);
		} else if (view === 'full') {
			// Full view includes related products and view count
			const related = await this.findRelated(record.categoryId, record.id);
			data = { ...record, relatedProducts: related, viewCount };
		} else {
			data = { ...record, viewCount };
		}

		return {
			status: 200,
			headers: {
				'ETag': etag,
				'Cache-Control': 'max-age=60, must-revalidate',
			},
			data,
		};
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

	async getTrending(target) {
		const limit = parseInt(target.get('limit')) || 10;
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
				results.push({
					id: product.id,
					name: product.name,
					description: product.description,
					price: product.price,
					imageUrl: product.imageUrl,
					featured: product.featured,
					categoryId: product.categoryId,
					tags: product.tags,
					viewCount: v.viewCount,
				});
			}
		}
		return results;
	}

	async getRelated(productId, target) {
		const product = await tables.Product.get(productId);
		if (!product) {
			throw httpError('Product not found', 404);
		}
		const limit = parseInt(target.get('limit')) || 10;
		return this.findRelated(product.categoryId, productId, limit);
	}

	async findRelated(categoryId, excludeId, limit) {
		const results = [];
		for await (const p of tables.Product.search({
			conditions: [{ attribute: 'categoryId', value: categoryId }],
			limit: (limit || 10) + 1,
		})) {
			if (p.id !== excludeId) {
				results.push(p);
			}
		}
		return results.slice(0, limit || 10);
	}

	async getFeatured(target) {
		const limit = parseInt(target.get('limit')) || 20;
		const results = [];
		for await (const p of tables.Product.search({
			conditions: [{ attribute: 'featured', value: true }],
			limit,
		})) {
			results.push(p);
		}
		return results;
	}

	async post(target, data) {
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
		if (data.featured === undefined) {
			data.featured = false;
		}
		return super.post(target, data);
	}

	async put(target, data) {
		return super.put(target, data);
	}

	async patch(target, data) {
		return super.patch(target, data);
	}
}
