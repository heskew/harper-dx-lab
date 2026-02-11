// Product Catalog — Access Control & Rate Limiting

// Tier field permissions
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

// Authenticate via X-API-Key header, returns key record or null
async function authenticate(resourceInstance) {
  const context = resourceInstance.getContext();
  const apiKey = context.headers.get('x-api-key');
  if (!apiKey) return null;

  const results = await tables.ApiKey.search({
    conditions: [{ attribute: 'key', value: apiKey }],
  });
  for (const k of results) {
    if (k.active !== false) return k;
  }
  return null;
}

// Check rate limit, set headers. Returns true if allowed, false if exceeded.
function checkRateLimit(apiKeyRecord, context) {
  const hourWindow = Math.floor(Date.now() / 3600000);
  const rlKey = `${apiKeyRecord.id}:${hourWindow}`;
  const limit = RATE_LIMITS[apiKeyRecord.tier] || 100;

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

// Auth + rate limit gate. Returns { denied, response, keyRecord, context }.
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

// Filter product fields based on tier and view mode
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
      const views = await tables.ProductView.search({});
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
      const products = await tables.Product.search({
        conditions: [{ attribute: 'featured', value: true }],
      });
      const out = [];
      for (const p of products) out.push(filterProduct(p, tier, view));
      return { data: out };
    }

    // Related products: /Product/{id}/related
    if (query.id && query.id.includes('/related')) {
      const productId = query.id.split('/')[0];
      const product = await tables.Product.get(productId);
      if (!product) {
        return { status: 404, headers: {}, data: { error: 'Product not found' } };
      }
      const same = await tables.Product.search({
        conditions: [{ attribute: 'categoryId', value: product.categoryId }],
      });
      const related = [];
      for (const p of same) {
        if (p.id !== productId) related.push(filterProduct(p, tier, view));
      }
      return { data: related };
    }

    // Single product
    if (query.id) {
      const product = await super.get(query);
      if (!product) return product;
      // Track view (authenticated, non-rate-limited request)
      try {
        await tables.ProductView.post({ productId: query.id, apiKeyId: g.keyRecord.id });
      } catch (_) { /* best effort */ }
      return filterProduct(product, tier, view);
    }

    // List all products
    const result = await super.get(query);
    const out = [];
    for (const p of result) {
      out.push(filterProduct(p, tier, view));
    }
    return out;
  }

  async post(data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return super.post(data);
  }

  async put(data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return super.put(data);
  }

  async patch(data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return super.patch(data);
  }

  async delete(query) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return super.delete(query);
  }
}

// ── Category Resource ─────────────────────────────────────────────
export class Category extends tables.Category {
  static loadAsInstance = false;

  async get(query) {
    const g = await gate(this);
    if (g.denied) return g.response;
    return super.get(query);
  }

  async post(data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return super.post(data);
  }

  async put(data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return super.put(data);
  }

  async patch(data) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return super.patch(data);
  }

  async delete(query) {
    const g = await gate(this, { write: true });
    if (g.denied) return g.response;
    return super.delete(query);
  }
}
