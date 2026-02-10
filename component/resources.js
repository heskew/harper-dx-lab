// Card view fields (minimal payload for mobile/listing)
const CARD_FIELDS = ['id', 'name', 'price', 'imageUrl', 'featured', 'categoryId'];

// All product fields for converting proxy objects to plain objects
const ALL_FIELDS = ['id', 'name', 'description', 'price', 'sku', 'imageUrl', 'featured', 'categoryId', 'tags', 'createdAt', 'updatedAt'];

function pickFields(record, fields) {
	if (!record) return record;
	const result = {};
	for (const f of fields) {
		if (record[f] !== undefined) result[f] = record[f];
	}
	return result;
}

function toPlain(record) {
	return pickFields(record, ALL_FIELDS);
}

export class Product extends tables.Product {
	static loadAsInstance = false;

	async get(target) {
		const record = await super.get(target);

		// For single record lookups, check for ?view=card
		if (record && !record[Symbol.asyncIterator]) {
			const context = this.getContext();
			const url = context?.url || '';
			if (url.includes('view=card')) {
				return pickFields(record, CARD_FIELDS);
			}
		}

		return record;
	}
}

// Card view of products — GET /ProductCard/ for listing, GET /ProductCard/<id> for single
export class ProductCard extends Resource {
	static loadAsInstance = false;

	async get(target) {
		if (target && target.id) {
			const product = await tables.Product.get(target.id);
			if (!product) {
				const error = new Error(`Product ${target.id} not found`);
				error.statusCode = 404;
				throw error;
			}
			return pickFields(product, CARD_FIELDS);
		}

		// Collection: return all products as card view
		const allProducts = tables.Product.search();
		const results = [];
		for await (const p of allProducts) {
			results.push(pickFields(p, CARD_FIELDS));
		}
		return results;
	}
}

// Track product views (fire-and-forget style — does not slow down reads)
export class ProductView extends tables.ProductView {
	static loadAsInstance = false;

	async post(target, data) {
		if (!data.productId) {
			const error = new Error('productId is required');
			error.statusCode = 400;
			throw error;
		}
		const product = await tables.Product.get(data.productId);
		if (!product) {
			const error = new Error(`Product ${data.productId} not found`);
			error.statusCode = 404;
			throw error;
		}
		return super.post(target, data);
	}
}

// Trending products endpoint — returns products sorted by view count
export class Trending extends Resource {
	static loadAsInstance = false;

	async get() {
		const viewCounts = {};
		const allViews = tables.ProductView.search();
		for await (const view of allViews) {
			viewCounts[view.productId] = (viewCounts[view.productId] || 0) + 1;
		}

		// Sort by count descending, take top 10
		const sorted = Object.entries(viewCounts)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10);

		const trending = [];
		for (const [productId, count] of sorted) {
			const product = await tables.Product.get(productId);
			if (product) {
				const plain = toPlain(product);
				plain.viewCount = count;
				trending.push(plain);
			}
		}

		return trending;
	}
}

// Related products endpoint — returns products in the same category
// Usage: GET /RelatedProducts/<productId>
export class RelatedProducts extends Resource {
	static loadAsInstance = false;

	async get(target) {
		if (!target || !target.id) {
			const error = new Error('Product ID is required: GET /RelatedProducts/<productId>');
			error.statusCode = 400;
			throw error;
		}

		const product = await tables.Product.get(target.id);
		if (!product) {
			const error = new Error(`Product ${target.id} not found`);
			error.statusCode = 404;
			throw error;
		}

		const targetCategoryId = product.categoryId;

		// Iterate all products and filter by matching category
		const allProducts = tables.Product.search();
		const related = [];
		for await (const p of allProducts) {
			if (p.id !== target.id && p.categoryId === targetCategoryId) {
				related.push(toPlain(p));
			}
		}

		return related;
	}
}
