'use strict';

/**
 * Scraper Registry
 *
 * Maps store slugs to their scraper modules and provides convenience
 * functions for scraping across all active stores or a single URL.
 */
const db = require('../db');

// ---------------------------------------------------------------------------
// Registry — add new scrapers here
// ---------------------------------------------------------------------------
const scrapers = {
  amazon:   require('./amazon'),
  walmart:  require('./walmart'),
  target:   require('./target'),
  cvs:      require('./cvs'),
  walgreens: require('./walgreens'),
  generic:   require('./generic'),
};

/**
 * Return the scraper module for a given store slug.
 * Falls back to the generic scraper if the specific one isn't registered.
 *
 * @param {string} slug
 * @returns {object|null} Scraper module with `scrapeProduct(url)` etc.
 */
function getScraper(slug) {
  return scrapers[slug] || scrapers.generic || null;
}

/**
 * Get all active stores from the DB and attempt to scrape each one,
 * inserting results as price snapshots.
 *
 * @param {object} product — { id, title, brand, ... } from the products table
 * @returns {Promise<Array<{storeId: number, storeName: string, price: number|null, available: boolean, url: string|null}>>}
 */
async function scrapeAll(product) {
  const stores = db.getStores();   // only active stores
  const results = [];

  for (const store of stores) {
    const scraper = getScraper(store.slug);
    if (!scraper) continue;

    try {
      // Look for an existing listing for this product + store
      const { getDb } = db;
      const listing = getDb()
        .prepare('SELECT * FROM product_listings WHERE product_id = ? AND store_id = ?')
        .get(product.id, store.id);

      if (!listing || !listing.url) continue;

      const scraped = await scraper.scrapeProduct(listing.url);

      // Save the price snapshot
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
      // Swallow per-store errors so one failure doesn't block the rest
      results.push({
        storeId: store.id,
        storeName: store.name,
        price: null,
        available: false,
        url: null,
        error: err.message,
      });
    }
  }

  return results;
}

/**
 * Scrape a single URL for a given store slug.
 * Resolves the scraper by slug, runs scrapeProduct, and returns the result.
 *
 * @param {string} url
 * @param {string} storeSlug
 * @returns {Promise<object>} ScrapeResult
 */
async function scrapeStore(url, storeSlug) {
  const scraper = getScraper(storeSlug);
  if (!scraper) {
    throw new Error(`No scraper registered for store slug "${storeSlug}"`);
  }

  return await scraper.scrapeProduct(url);
}

/**
 * Search a store's site for a given query and return result listings.
 * Each scraper must implement a `searchProduct(query)` function.
 * Falls back to the generic scraper if the specific one doesn't implement search.
 *
 * @param {string} query
 * @param {string} storeSlug
 * @returns {Promise<Array<{title: string, price: number|null, url: string}>>}
 */
async function searchStore(query, storeSlug) {
  const scraper = getScraper(storeSlug);
  if (!scraper) {
    throw new Error(`No scraper registered for store slug "${storeSlug}"`);
  }

  if (typeof scraper.searchProduct === 'function') {
    return await scraper.searchProduct(query);
  }

  // Fallback: try the generic scraper
  if (scrapers.generic && typeof scrapers.generic.searchProduct === 'function') {
    return await scrapers.generic.searchProduct(query);
  }

  return [];
}

// ---------------------------------------------------------------------------
// Close all browser instances (cleanup on shutdown)
// ---------------------------------------------------------------------------
async function closeAll() {
  const results = await Promise.allSettled(
    Object.values(scrapers).map((s) => {
      if (typeof s.closeBrowser === 'function') return s.closeBrowser();
      return Promise.resolve();
    }),
  );
  return results;
}

module.exports = {
  scrapers,
  getScraper,
  scrapeAll,
  scrapeStore,
  searchStore,
  closeAll,
};
