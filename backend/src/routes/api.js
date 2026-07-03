'use strict';

/**
 * Shopping Compass — API Routes
 *
 * All handlers use `require('../db')` for data access and
 * `require('../scrapers')` for scraper operations.
 */
const db = require('../db');
const scrapers = require('../scrapers');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wraps an async Fastify route handler so errors always return JSON.
 */
function asyncHandler(fn) {
  return async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      request.log.error(err);
      return reply.code(err.statusCode || 500).send({
        error: err.message || 'Internal server error',
      });
    }
  };
}

/**
 * Parse an optional integer query parameter.
 */
function intParam(val) {
  if (val === undefined || val === null) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

/**
 * @param {import('fastify').FastifyInstance} app
 */
module.exports = async function (app) {
  // ===================================================================
  // PRODUCTS
  // ===================================================================

  // GET /api/products?list=:listId
  app.get(
    '/products',
    asyncHandler(async (request) => {
      const listId = intParam(request.query.list);

      if (listId) {
        return db.getProductsByList(listId);
      }

      // Return all products with their latest price from Amazon
      const all = db
        .getDb()
        .prepare(
          `SELECT p.*, ps.price AS price, ps.fetched_at AS price_fetched_at
           FROM products p
           LEFT JOIN product_listings pl ON pl.product_id = p.id
             AND pl.store_id = (SELECT id FROM stores WHERE slug = 'amazon' LIMIT 1)
           LEFT JOIN (
             SELECT product_listing_id, price, fetched_at
             FROM price_snapshots
             WHERE id IN (SELECT MAX(id) FROM price_snapshots GROUP BY product_listing_id)
           ) ps ON ps.product_listing_id = pl.id
           ORDER BY p.created_at DESC`,
        )
        .all();

      // Map to camelCase for the API
      return all.map((row) => ({
        id: row.id,
        title: row.title,
        brand: row.brand,
        imageUrl: row.image_url,
        price: row.price,
        listId: null, // not scoped to a single list
      }));
    }),
  );

  // GET /api/products/:id
  app.get(
    '/products/:id',
    asyncHandler(async (request) => {
      const productId = intParam(request.params.id);
      if (!productId) {
        return { error: 'Invalid product id' };
      }

      const detail = db.getProductDetail(productId);
      if (!detail) {
        return { error: 'Product not found' };
      }

      const { product, listings } = detail;

      // Fetch list memberships
      const listIds = db
        .getDb()
        .prepare(
          `SELECT ul.id AS listId, ul.name AS listName
           FROM user_lists ul
           JOIN user_list_items uli ON uli.user_list_id = ul.id
           WHERE uli.product_id = ?
           ORDER BY ul.name`,
        )
        .all(productId);

      // Fetch pending match suggestions
      const pendingMatches = db.getMatchSuggestions(productId).map((m) => ({
        storeId: m.store_id,
        storeName: m.store_name,
        sourceTitle: m.source_title,
        confidence: m.confidence,
      }));

      return {
        id: product.id,
        title: product.title,
        brand: product.brand,
        description: product.description,
        imageUrl: product.image_url,
        notes: product.notes,
        listings: listings.map((l) => ({
          store: l.store_name,
          storeSlug: l.store_slug,
          price: l.latest_price,
          url: l.url,
          inStorePickup: !!l.in_store_pickup,
          shippingEligible: !!l.shipping_eligible,
          available: !!l.available,
          lastFetched: l.price_fetched_at,
        })),
        listIds: listIds.map((r) => ({ listId: r.listId, listName: r.listName })),
        pendingMatches,
      };
    }),
  );

  // GET /api/products/:id/prices
  app.get(
    '/products/:id/prices',
    asyncHandler(async (request) => {
      const productId = intParam(request.params.id);
      if (!productId) {
        return { error: 'Invalid product id' };
      }

      const snapshots = db.getPricesForProduct(productId);
      return snapshots.map((s) => ({
        storeId: s.store_id,
        storeName: s.store_name,
        price: s.price,
        inStorePickup: !!s.in_store_pickup,
        shippingEligible: !!s.shipping_eligible,
        available: !!s.available,
        fetchedAt: s.fetched_at,
        url: s.listing_url,
      }));
    }),
  );

  // POST /api/products
  app.post(
    '/products',
    asyncHandler(async (request) => {
      const { title, brand, notes, url, listId } = request.body || {};

      if (!title || typeof title !== 'string' || !title.trim()) {
        return { error: 'title is required' };
      }

      // Create the product
      const productId = db.createProduct({
        title: title.trim(),
        brand: brand || null,
        image_url: null,
        notes: notes || null,
      });

      // If an Amazon URL was provided, create an Amazon listing
      if (url) {
        const amazonStore = db
          .getDb()
          .prepare("SELECT id FROM stores WHERE slug = 'amazon'")
          .get();

        if (amazonStore) {
          const listingId = db.createProductListing(productId, amazonStore.id, {
            url,
            title: title.trim(),
          });

          // Optionally kick off a scrape in the background
          setImmediate(async () => {
            try {
              const amzScraper = scrapers.getScraper('amazon');
              if (amzScraper) {
                const result = await amzScraper.scrapeProduct(url);
                if (result.price !== null || result.available !== undefined) {
                  db.insertPriceSnapshot(listingId, {
                    price: result.price,
                    currency: result.currency || 'USD',
                    in_store_pickup: result.inStorePickup,
                    shipping_eligible: result.shippingEligible,
                    available: result.available,
                  });
                }
              }
            } catch (_) {
              // background scrape failures are non-fatal
            }
          });
        }
      }

      // Optionally add to a list
      if (listId) {
        db.addItemToList(listId, productId);
      }

      return { id: productId };
    }),
  );

  // ===================================================================
  // SEARCH
  // ===================================================================

  // GET /api/search?q=:query&stores=:commaSeparatedStoreIds
  app.get(
    '/search',
    asyncHandler(async (request) => {
      const q = (request.query.q || '').trim();
      if (!q) {
        return [];
      }

      const likePattern = `%${q}%`;

      // Search products by title (SQLite LIKE)
      const products = db
        .getDb()
        .prepare(
          `SELECT p.id, p.title, p.brand, p.image_url
           FROM products p
           WHERE p.title LIKE ?
           ORDER BY p.title ASC`,
        )
        .all(likePattern);

      if (products.length === 0) {
        return [];
      }

      // Fetch latest prices for each product from all stores
      const productIds = products.map((p) => p.id);
      const placeholders = productIds.map(() => '?').join(',');

      const prices = db
        .getDb()
        .prepare(
          `SELECT pl.product_id, s.id AS store_id, s.name AS store_name, s.slug AS store_slug,
                  ps.price, pl.url
           FROM product_listings pl
           JOIN stores s ON s.id = pl.store_id
           LEFT JOIN (
             SELECT product_listing_id, price
             FROM price_snapshots
             WHERE id IN (SELECT MAX(id) FROM price_snapshots GROUP BY product_listing_id)
           ) ps ON ps.product_listing_id = pl.id
           WHERE pl.product_id IN (${placeholders})`,
        )
        .all(...productIds);

      // Group prices by product_id
      const pricesByProduct = {};
      for (const p of prices) {
        if (!pricesByProduct[p.product_id]) {
          pricesByProduct[p.product_id] = [];
        }
        pricesByProduct[p.product_id].push({
          storeId: p.store_id,
          storeName: p.store_name,
          price: p.price,
          url: p.url,
        });
      }

      // If stores param provided, trigger scrapes for those stores in background
      const storeIds = request.query.stores
        ? request.query.stores
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => !isNaN(n))
        : [];

      if (storeIds.length > 0) {
        setImmediate(async () => {
          const targetStores = db
            .getDb()
            .prepare(`SELECT id, slug FROM stores WHERE id IN (${storeIds.map(() => '?').join(',')})`)
            .all(...storeIds);

          for (const product of products) {
            for (const store of targetStores) {
              const listing = db
                .getDb()
                .prepare(
                  'SELECT id, url FROM product_listings WHERE product_id = ? AND store_id = ?',
                )
                .get(product.id, store.id);

              if (listing && listing.url) {
                try {
                  const result = await scrapers.scrapeStore(listing.url, store.slug);
                  if (result.price !== null || result.available !== undefined) {
                    db.insertPriceSnapshot(listing.id, {
                      price: result.price,
                      available: result.available,
                      shipping_eligible: result.shippingEligible,
                      in_store_pickup: result.inStorePickup,
                    });
                  }
                } catch (_) {
                  // per-store scrape failures are non-fatal
                }
              }
            }
          }
        });
      }

      return products.map((p) => ({
        id: p.id,
        title: p.title,
        brand: p.brand,
        imageUrl: p.image_url,
        prices: pricesByProduct[p.id] || [],
      }));
    }),
  );

  // ===================================================================
  // STORES
  // ===================================================================

  // GET /api/stores
  app.get(
    '/stores',
    asyncHandler(async () => {
      return db
        .getDb()
        .prepare('SELECT id, name, slug, active, base_url AS baseUrl FROM stores ORDER BY name ASC')
        .all();
    }),
  );

  // POST /api/stores
  app.post(
    '/stores',
    asyncHandler(async (request) => {
      const { name, slug, baseUrl } = request.body || {};

      if (!name || !slug) {
        return { error: 'name and slug are required' };
      }

      const result = db
        .getDb()
        .prepare(
          `INSERT INTO stores (name, slug, base_url, has_scraper, active)
           VALUES (?, ?, ?, 0, 1)`,
        )
        .run(name.trim(), slug.trim(), baseUrl || null);

      return { id: Number(result.lastInsertRowid) };
    }),
  );

  // PUT /api/stores/:id
  app.put(
    '/stores/:id',
    asyncHandler(async (request) => {
      const storeId = intParam(request.params.id);
      if (!storeId) {
        return { error: 'Invalid store id' };
      }

      const { active, name, baseUrl } = request.body || {};

      const updates = [];
      const values = [];

      if (active !== undefined) {
        updates.push('active = ?');
        values.push(active ? 1 : 0);
      }
      if (name !== undefined) {
        updates.push('name = ?');
        values.push(name.trim());
      }
      if (baseUrl !== undefined) {
        updates.push('base_url = ?');
        values.push(baseUrl);
      }

      if (updates.length === 0) {
        return { error: 'No fields to update' };
      }

      values.push(storeId);
      db.getDb()
        .prepare(`UPDATE stores SET ${updates.join(', ')} WHERE id = ?`)
        .run(...values);

      return { id: storeId };
    }),
  );

  // ===================================================================
  // LISTS
  // ===================================================================

  // GET /api/lists
  app.get(
    '/lists',
    asyncHandler(async () => {
      const lists = db
        .getDb()
        .prepare(
          `SELECT ul.id, ul.name, ul.source, ul.created_at AS createdAt,
                  COUNT(uli.id) AS itemCount
           FROM user_lists ul
           LEFT JOIN user_list_items uli ON uli.user_list_id = ul.id
           GROUP BY ul.id
           ORDER BY ul.created_at DESC`,
        )
        .all();

      return lists.map((l) => ({
        id: l.id,
        name: l.name,
        source: l.source,
        itemCount: l.itemCount,
        createdAt: l.createdAt,
      }));
    }),
  );

  // GET /api/lists/:id
  app.get(
    '/lists/:id',
    asyncHandler(async (request) => {
      const listId = intParam(request.params.id);
      if (!listId) {
        return { error: 'Invalid list id' };
      }

      const list = db
        .getDb()
        .prepare('SELECT id, name, source, created_at AS createdAt FROM user_lists WHERE id = ?')
        .get(listId);

      if (!list) {
        return { error: 'List not found' };
      }

      const items = db
        .getDb()
        .prepare(
          `SELECT p.id AS productId, p.title, p.brand, p.image_url AS imageUrl,
                  ps.price
           FROM user_list_items uli
           JOIN products p ON p.id = uli.product_id
           LEFT JOIN product_listings pl ON pl.product_id = p.id
             AND pl.store_id = (SELECT id FROM stores WHERE slug = 'amazon' LIMIT 1)
           LEFT JOIN (
             SELECT product_listing_id, price
             FROM price_snapshots
             WHERE id IN (SELECT MAX(id) FROM price_snapshots GROUP BY product_listing_id)
           ) ps ON ps.product_listing_id = pl.id
           WHERE uli.user_list_id = ?
           ORDER BY uli.sort_order ASC, uli.added_at DESC`,
        )
        .all(listId);

      return {
        id: list.id,
        name: list.name,
        source: list.source,
        items: items.map((i) => ({
          productId: i.productId,
          title: i.title,
          brand: i.brand,
          price: i.price,
          imageUrl: i.imageUrl,
        })),
      };
    }),
  );

  // POST /api/lists
  app.post(
    '/lists',
    asyncHandler(async (request) => {
      const { name, source } = request.body || {};

      if (!name || typeof name !== 'string' || !name.trim()) {
        return { error: 'name is required' };
      }

      const id = db.createUserList({ name: name.trim(), source: source || 'manual' });
      return { id };
    }),
  );

  // DELETE /api/lists/:id
  app.delete(
    '/lists/:id',
    asyncHandler(async (request) => {
      const listId = intParam(request.params.id);
      if (!listId) {
        return { error: 'Invalid list id' };
      }

      const existing = db
        .getDb()
        .prepare('SELECT id FROM user_lists WHERE id = ?')
        .get(listId);

      if (!existing) {
        return { error: 'List not found' };
      }

      // user_list_items cascade via FK, but ensure FK is on
      db.getDb().prepare('PRAGMA foreign_keys = ON').run();
      db.getDb().prepare('DELETE FROM user_lists WHERE id = ?').run(listId);

      return { ok: true };
    }),
  );

  // ===================================================================
  // IMPORT
  // ===================================================================

  // POST /api/import/amazon-lists
  app.post(
    '/import/amazon-lists',
    asyncHandler(async () => {
      // Delegate to the import module
      let importer;
      try {
        importer = require('../import/amazon-list');
      } catch (_) {
        return { listsImported: 0, itemsImported: 0, error: 'Import module not available' };
      }

      const result = await importer.run();
      return {
        listsImported: result.listsImported || 0,
        itemsImported: result.itemsImported || 0,
      };
    }),
  );

  // ===================================================================
  // MATCHES
  // ===================================================================

  // POST /api/matches
  app.post(
    '/matches',
    asyncHandler(async (request) => {
      const { matchSuggestionId, status } = request.body || {};

      if (!matchSuggestionId || !['confirmed', 'rejected'].includes(status)) {
        return { error: 'matchSuggestionId and status ("confirmed"|"rejected") are required' };
      }

      const suggestion = db
        .getDb()
        .prepare('SELECT * FROM match_suggestions WHERE id = ?')
        .get(matchSuggestionId);

      if (!suggestion) {
        return { error: 'Match suggestion not found' };
      }

      db.updateMatchStatus(matchSuggestionId, status);

      // If confirmed, create the product_listing
      if (status === 'confirmed') {
        db.createProductListing(suggestion.product_id, suggestion.store_id, {
          url: suggestion.source_url,
          title: suggestion.source_title,
        });
      }

      return { ok: true };
    }),
  );

  // GET /api/products/:id/matches
  app.get(
    '/products/:id/matches',
    asyncHandler(async (request) => {
      const productId = intParam(request.params.id);
      if (!productId) {
        return { error: 'Invalid product id' };
      }

      const matches = db.getMatchSuggestions(productId);
      return matches.map((m) => ({
        id: m.id,
        storeName: m.store_name,
        sourceTitle: m.source_title,
        confidence: m.confidence,
        status: m.status,
        url: m.source_url,
      }));
    }),
  );

  // ===================================================================
  // SCRAPE
  // ===================================================================

  // POST /api/scan/:productId
  app.post(
    '/scan/:productId',
    asyncHandler(async (request) => {
      const productId = intParam(request.params.productId);
      if (!productId) {
        return { error: 'Invalid product id' };
      }

      const detail = db.getProductDetail(productId);
      if (!detail) {
        return { error: 'Product not found' };
      }

      const stores = db.getStores();
      const results = [];

      for (const store of stores) {
        const listing = db
          .getDb()
          .prepare(
            'SELECT id, url FROM product_listings WHERE product_id = ? AND store_id = ?',
          )
          .get(productId, store.id);

        if (!listing || !listing.url) continue;

        try {
          const scraped = await scrapers.scrapeStore(listing.url, store.slug);

          if (scraped.price !== null || scraped.available !== undefined) {
            db.insertPriceSnapshot(listing.id, {
              price: scraped.price,
              currency: scraped.currency || 'USD',
              in_store_pickup: scraped.inStorePickup,
              shipping_eligible: scraped.shippingEligible,
              available: scraped.available,
            });
          }

          results.push({
            storeId: store.id,
            storeName: store.name,
            price: scraped.price,
            available: scraped.available,
            url: scraped.url || listing.url,
          });
        } catch (err) {
          results.push({
            storeId: store.id,
            storeName: store.name,
            price: null,
            available: false,
            url: listing.url,
            error: err.message,
          });
        }
      }

      return results;
    }),
  );

  // POST /api/scan-url
  app.post(
    '/scan-url',
    asyncHandler(async (request) => {
      const { url, storeId } = request.body || {};

      if (!url) {
        return { error: 'url is required' };
      }

      // Resolve store from storeId or try to detect from URL
      let store;

      if (storeId) {
        store = db
          .getDb()
          .prepare('SELECT id, slug, name FROM stores WHERE id = ?')
          .get(storeId);
      } else {
        // Auto-detect store from URL domain
        const domain = new URL(url).hostname.toLowerCase();

        if (domain.includes('amazon')) {
          store = db.getDb().prepare("SELECT id, slug, name FROM stores WHERE slug = 'amazon'").get();
        } else if (domain.includes('walmart')) {
          store = db.getDb().prepare("SELECT id, slug, name FROM stores WHERE slug = 'walmart'").get();
        } else if (domain.includes('target')) {
          store = db.getDb().prepare("SELECT id, slug, name FROM stores WHERE slug = 'target'").get();
        } else if (domain.includes('cvs')) {
          store = db.getDb().prepare("SELECT id, slug, name FROM stores WHERE slug = 'cvs'").get();
        } else if (domain.includes('walgreens')) {
          store = db.getDb().prepare("SELECT id, slug, name FROM stores WHERE slug = 'walgreens'").get();
        } else {
          // Use the generic scraper
          store = { id: null, slug: 'generic', name: 'Unknown' };
        }
      }

      if (!store) {
        return { error: 'Could not determine store for URL. Provide storeId.' };
      }

      const result = await scrapers.scrapeStore(url, store.slug);

      return {
        title: result.title,
        price: result.price,
        available: result.available,
        url: result.url || url,
        storeId: store.id,
        storeName: store.name,
      };
    }),
  );

  // POST /api/search-scrape
  app.post(
    '/search-scrape',
    asyncHandler(async (request) => {
      const { query, storeIds } = request.body || {};

      if (!query || typeof query !== 'string' || !query.trim()) {
        return { error: 'query is required' };
      }

      // Determine which stores to search
      let stores;

      if (storeIds && Array.isArray(storeIds) && storeIds.length > 0) {
        const placeholders = storeIds.map(() => '?').join(',');
        stores = db
          .getDb()
          .prepare(
            `SELECT id, slug, name FROM stores WHERE id IN (${placeholders}) AND active = 1`,
          )
          .all(...storeIds);
      } else {
        stores = db.getStores();
      }

      const results = [];

      for (const store of stores) {
        try {
          const items = await scrapers.searchStore(query, store.slug);
          results.push({
            storeId: store.id,
            storeName: store.name,
            results: items.map((item) => ({
              title: item.title,
              price: item.price,
              url: item.url,
            })),
          });
        } catch (err) {
          results.push({
            storeId: store.id,
            storeName: store.name,
            results: [],
            error: err.message,
          });
        }
      }

      return results;
    }),
  );
};
