// Product Catalog — Access Control & Rate Limiting

const TIER_FIELDS = {
  bronze: ['id', 'name', 'price', 'categoryId'],
  silver: ['id', 'name', 'description', 'price', 'sku', 'imageUrl', 'featured',
           'categoryId', 'inventoryCount', 'tags', 'createdAt', 'updatedAt'],
  gold: ['id', 'name', 'description', 'price', 'sku', 'imageUrl', 'featured',
         'categoryId', 'inventoryCount', 'tags', 'supplierName', 'supplierContact',
         'costPrice', 'createdAt', 'updatedAt'],
};
const CARD_FIELDS = ['id', 'name', 'price', 'categoryId', 'imageUrl'];
const RATE_LIMITS = { bronze: 100, silver: 1000, gold: 10000 };

// In-memory rate limit tracking: "keyId:hourWindow" -> { count }
const rateLimitMap = new Map();

async function authenticate(resourceInstance) {
  const context = resourceInstance.getContext();
  const apiKey = context.headers.get('x-api-key');
  if (!apiKey) return null;
  const results = await tables.ApiKey.search({
    conditions: [{ attribute: 'key', value: apiKey }],
  });
  for await (const k of results) {
    if (k.active !== false) return k;
  }
  return null;
}

function checkRateLimit(keyRecord, context) {
  const hourWindow = Math.floor(Date.now() / 3600000);
  const rlKey = `${keyRecord.id}:${hourWindow}`;
  const limit = RATE_LIMITS[keyRecord.tier] || 100;

  let rl = rateLimitMap.get(rlKey);
  if (!rl) {
    rl = { count: 0 };
    rateLimitMap.set(rlKey, rl);
  }
  rl.count++;

  context.responseHeaders.set('X-RateLimit-Limit', String(limit));

  if (rl.count > limit) {
    const windowEnd = (hourWindow + 1) * 3600000;
    const retryAfter = Math.ceil((windowEnd - Date.now()) / 1000);
    context.responseHeaders.set('X-RateLimit-Remaining', '0');
    context.responseHeaders.set('Retry-After', String(retryAfter));
    return false;
  }

  context.responseHeaders.set('X-RateLimit-Remaining', String(limit - rl.count));
  return true;
}

async function gate(resourceInstance, { write = false } = {}) {
  const context = resourceInstance.getContext();
  const keyRecord = await authenticate(resourceInstance);
  if (!keyRecord) {
    return {
      denied: true,
      response: { status: 401, headers: {}, data: { error: 'Unauthorized: missing or invalid API key' } },
    };
  }

  const allowed = checkRateLimit(keyRecord, context);
  if (!allowed) {
    return {
      denied: true,
      response: { status: 429, headers: {}, data: { error: 'Rate limit exceeded' } },
    };
  }

  if (write && keyRecord.tier !== 'gold') {
    return {
      denied: true,
      response: { status: 403, headers: {}, data: { error: 'Write access requires Gold tier' } },
    };
  }

  return { denied: false, keyRecord, context };
}

function filterProduct(product, tier, view) {
  if (!product) return product;
  let allowed = TIER_FIELDS[tier] || TIER_FIELDS.bronze;
  if (view === 'card') {
    allowed = allowed.filter(f => CARD_FIELDS.includes(f));
  }
  const out = {};
  for (const f of allowed) {
    if (product[f] !== undefined) out[f] = product[f];
  }
  return out;
}

// ── Product Resource ──────────────────────────────────────────────
export class Product extends tables.Product {
  static loadAsInstance = false;

  async get(query) {
    const g = await gate(this);
    if (g.denied) return g.response;

    const view = g.context.headers.get('x-view') || 'full';
    const tier = g.keyRecord.tier;

    // Trending products
    if (query.id === 'trending') {
      const views = [];
      for await (const v of await tables.ProductView.search({})) {
        views.push(v);
      }
      const counts = {};
      for (const v of views) {
        counts[v.productId] = (counts[v.productId] || 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const trending = [];
      for (const [pid, count] of sorted) {
        const p = await tables.Product.get(pid);
        if (p) trending.push({ ...filterProduct(p, tier, view), viewCount: count });
      }
      return { data: trending };
    }

    // Featured products
    if (query.id === 'featured') {
      const products = [];
      for await (const p of await tables.Product.search({
        conditions: [{ attribute: 'featured', value: true }],
      })) {
        products.push(filterProduct(p, tier, view));
      }
      return { data: products };
    }

    // Related products
    if (query.id && String(query.id).includes('/related')) {
      const productId = String(query.id).split('/')[0];
      const product = await tables.Product.get(productId);
      if (!product) {
        return { status: 404, headers: {}, data: { error: 'Product not found' } };
      }
      const related = [];
      for await (const p of await tables.Product.search({
        conditions: [{ attribute: 'categoryId', value: product.categoryId }],
      })) {
        if (p.id !== productId) related.push(filterProduct(p, tier, view));
      }
      return { data: related };
    }

    // Single product by ID
    if (query.id) {
      const product = await tables.Product.get(query.id);
      if (!product) return { status: 404, headers: {}, data: { error: 'Product not found' } };
      // Track view (fire and forget via setTimeout to avoid 201 status leak)
      setTimeout(() => {
        tables.ProductView.post({ productId: query.id, apiKeyId: g.keyRecord.id }).catch(() => {});
      }, 0);
      return filterProduct(product, tier, view);
    }

    // List all products
    const result = [];
    for await (const p of await tables.Product.search({})) {
      result.push(filterProduct(p, tier, view));
    }
    return result;
  }

  async post(target, data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return tables.Product.post(data);
  }

  async put(target, data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return tables.Product.put({ id: target.id, ...data });
  }

  async patch(target, data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return tables.Product.patch(target.id, data);
  }

  async delete(target) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return tables.Product.delete(target.id);
  }
}

// ── Category Resource ─────────────────────────────────────────────
export class Category extends tables.Category {
  static loadAsInstance = false;

  async get(query) {
    const g = await gate(this);
    if (g.denied) return g.response;
    if (query.id) {
      const cat = await tables.Category.get(query.id);
      if (!cat) return { status: 404, headers: {}, data: { error: 'Category not found' } };
      return cat;
    }
    const result = [];
    for await (const c of await tables.Category.search({})) {
      result.push(c);
    }
    return result;
  }

  async post(target, data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return tables.Category.post(data);
  }

  async put(target, data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return tables.Category.put({ id: target.id, ...data });
  }

  async patch(target, data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return tables.Category.patch(target.id, data);
  }

  async delete(target) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return tables.Category.delete(target.id);
  }
}
