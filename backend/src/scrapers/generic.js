'use strict';

/**
 * Generic product page scraper — best-effort extraction from any store URL.
 *
 * Uses Playwright headless Chromium with multiple fallback strategies for
 * title, price, image, and availability. Returns best-guess values, never
 * throws. Designed for the Shopping Compass private price comparison tool.
 *
 * @module scrapers/generic
 */

const { chromium } = require('playwright');

// ---------------------------------------------------------------------------
// Singleton browser management
// ---------------------------------------------------------------------------

/** @type {import('playwright').Browser | null} */
let _browser = null;
/** @type {import('playwright').BrowserContext | null} */
let _context = null;

/**
 * Returns the shared Playwright Chromium instance, launching one if needed.
 * @returns {Promise<import('playwright').Browser>}
 */
async function getBrowser() {
  if (_browser && _browser.isConnected()) {
    return _browser;
  }
  _browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  return _browser;
}

/**
 * Returns a shared browser context, creating one if needed.
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function getContext() {
  await getBrowser();
  if (_context && !_context.isClosed()) return _context;
  _context = await _browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/125.0.0.0 Safari/537.36',
  });
  return _context;
}

/**
 * Closes the shared browser instance if it is running.
 * @returns {Promise<void>}
 */
async function closeBrowser() {
  if (_context) {
    try { await _context.close(); } catch (_) {}
    _context = null;
  }
  if (_browser) {
    try { await _browser.close(); } catch (_) {}
    _browser = null;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Minimal-object logger. Replace with a structured logger in production.
 * Logs to console when `process.env.DEBUG` or `process.env.VERBOSE` is set.
 */
const log = {
  debug: (...args) => {
    if (process.env.DEBUG || process.env.VERBOSE) {
      console.debug('[generic-scraper]', ...args);
    }
  },
  warn: (...args) => {
    console.warn('[generic-scraper]', ...args);
  },
};

/**
 * Normalise a currency code found on the page.
 * @param {string | null} raw
 * @returns {string}
 */
function normaliseCurrency(raw) {
  if (!raw) return 'USD';
  const map = {
    $: 'USD', 'US$': 'USD', 'USD': 'USD',
    '£': 'GBP', 'GBP': 'GBP',
    '€': 'EUR', 'EUR': 'EUR',
    'CA$': 'CAD', 'CAD': 'CAD',
    'A$': 'AUD', 'AUD': 'AUD',
    '¥': 'JPY', 'JPY': 'JPY',
  };
  const trimmed = raw.trim();
  return map[trimmed] || map[trimmed.toUpperCase()] || trimmed;
}

/**
 * Parse a price string (e.g. "$29.99", "19,95 €") into a float.
 * Returns null on failure.
 * @param {string} str
 * @returns {number | null}
 */
function parsePrice(str) {
  if (!str) return null;
  // Remove common thousand separators but keep decimal
  let cleaned = str
    .replace(/[^0-9.,]/g, '')       // strip everything except digits, dot, comma
    .replace(/\.(?=\d{3}[.,]?)/g, '') // remove dots used as thousand separators (1.234 → 1234)
    .replace(',', '.');              // normalise decimal comma to dot
  // Handle double dots from bad normalisation
  const parts = cleaned.split('.');
  if (parts.length > 2) {
    // Keep only first two parts (integer.decimal), join rest
    cleaned = parts[0] + '.' + parts.slice(1).join('');
  }
  const val = parseFloat(cleaned);
  return isFinite(val) ? val : null;
}

/**
 * Score a price candidate — prefer values in a typical product range.
 * @param {number} price
 * @returns {number} Higher is better.
 */
function scorePrice(price) {
  if (price <= 0) return -1;
  if (price > 0.5 && price < 10000) return 10;
  if (price <= 0.5) return 0; // likely tax or shipping
  return 1; // extreme value — low confidence
}

// ---------------------------------------------------------------------------
// Extraction helpers (run inside page context)
// ---------------------------------------------------------------------------

/**
 * Extract product title using multiple strategies.
 * @param {import('playwright').Page} page
 * @returns {Promise<string | null>}
 */
async function extractTitle(page) {
  // 1. og:title meta
  try {
    const ogTitle = await page.$eval('meta[property="og:title"]', el => el.content);
    if (ogTitle && ogTitle.trim()) {
      log.debug('title: found via og:title');
      return ogTitle.trim();
    }
  } catch (_) { /* not present */ }

  // 2. h1 element (prefer first meaningful one)
  try {
    const h1 = await page.$eval('h1', el => el.textContent);
    if (h1 && h1.trim()) {
      log.debug('title: found via h1');
      return h1.trim();
    }
  } catch (_) { /* not present */ }

  // 3. <title> tag
  try {
    const titleTag = await page.title();
    if (titleTag && titleTag.trim()) {
      // Strip site suffix like " - StoreName" if present
      const cleaned = titleTag.trim().split(' - ')[0].split(' | ')[0].trim();
      if (cleaned) {
        log.debug('title: found via <title>');
        return cleaned;
      }
    }
  } catch (_) { /* not present */ }

  // 4. First large heading (h2, h3 with significant text)
  try {
    const headings = await page.$$eval('h2, h3', els =>
      els.filter(el => (el.textContent || '').trim().length > 10)
         .map(el => el.textContent.trim())
    );
    if (headings.length > 0) {
      log.debug('title: found via first large heading');
      return headings[0];
    }
  } catch (_) { /* not present */ }

  return null;
}

/**
 * Extract price using multiple strategies.
 * Returns the best-guess price or null.
 * @param {import('playwright').Page} page
 * @returns {Promise<{ price: number | null, currency: string }>}
 */
async function extractPrice(page) {
  const candidates = [];

  // --- Strategy 1: Structured meta tags ---
  try {
    const metaPrice = await page.$eval('meta[property="product:price:amount"], meta[property="og:price:amount"]', el => el.content);
    const parsed = parsePrice(metaPrice);
    if (parsed !== null) {
      log.debug('price candidate: meta tag →', parsed);
      candidates.push({ price: parsed, source: 'meta', confidence: 9 });
    }
  } catch (_) { /* not present */ }

  // --- Strategy 2: JSON-LD structured data ---
  try {
    const ldScripts = await page.$$eval(
      'script[type="application/ld+json"]',
      scripts => scripts.map(s => s.textContent).filter(Boolean)
    );
    for (const raw of ldScripts) {
      try {
        const data = JSON.parse(raw);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          // Walk @graph if present
          const graph = item['@graph'] || [item];
          for (const node of graph) {
            if (
              node['@type'] === 'Product' ||
              node['@type'] === 'Offer' ||
              (node.offers && node.offers.price)
            ) {
              const offer = node.offers || node;
              const priceVal = offer.price || offer.highPrice;
              if (priceVal != null) {
                const parsed = parsePrice(String(priceVal));
                if (parsed !== null) {
                  log.debug('price candidate: JSON-LD →', parsed);
                  candidates.push({ price: parsed, source: 'jsonld', confidence: 8 });
                }
              }
            }
          }
        }
      } catch (_) { /* malformed JSON — skip */ }
    }
  } catch (_) { /* not present */ }

  // --- Strategy 3: Common CSS selectors ---
  const selectors = [
    '[itemprop="price"]',
    '[itemprop="lowPrice"]',
    '.price',
    '.product-price',
    '.sale-price',
    '.offer-price',
    '[class*="price"]',
    '[class*="Price"]',
    'span.amount',
    '.woocommerce-Price-amount',
    '[data-testid="price"]',
    '[data-automation="price"]',
  ];

  for (const sel of selectors) {
    try {
      const els = await page.$$(sel);
      for (const el of els) {
        const text = await el.textContent();
        if (!text) continue;
        const parsed = parsePrice(text);
        if (parsed !== null) {
          log.debug(`price candidate: selector "${sel}" →`, parsed);
          candidates.push({ price: parsed, source: sel, confidence: 7 });
        }
      }
    } catch (_) { /* element not found */ }
  }

  // --- Strategy 4: Regex scan of visible text ---
  try {
    const bodyText = await page.evaluate(() => document.body.innerText);
    // Match patterns like $12.34, $1,234.56, €12,34
    const regex = /[$£€]?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})/g;
    let match;
    while ((match = regex.exec(bodyText)) !== null) {
      const parsed = parsePrice(match[0]);
      if (parsed !== null && parsed > 0.5 && parsed < 100000) {
        log.debug('price candidate: regex match →', match[0], '→', parsed);
        candidates.push({ price: parsed, source: 'regex', confidence: 4 });
      }
    }
  } catch (_) { /* body not accessible */ }

  // --- Pick the best candidate ---
  let best = null;
  let bestScore = -1;

  for (const c of candidates) {
    const score = scorePrice(c.price) + c.confidence;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  // --- Determine currency ---
  let currency = 'USD';

  // Try og:price:currency first
  try {
    const metaCurr = await page.$eval('meta[property="product:price:currency"], meta[property="og:price:currency"]', el => el.content);
    if (metaCurr) currency = normaliseCurrency(metaCurr);
  } catch (_) { /* not present */ }

  // Fall back to scanning visible text for currency symbols if we haven't got one
  if (currency === 'USD' && best) {
    try {
      const bodyText = await page.evaluate(() => document.body.innerText);
      if (/[£]/.test(bodyText)) currency = 'GBP';
      else if (/[€]/.test(bodyText)) currency = 'EUR';
      else if (/CA[$]/.test(bodyText)) currency = 'CAD';
    } catch (_) { /* */ }
  }

  return { price: best ? best.price : null, currency };
}

/**
 * Extract product image URL.
 * @param {import('playwright').Page} page
 * @returns {Promise<string | null>}
 */
async function extractImage(page) {
  // 1. og:image
  try {
    const ogImage = await page.$eval('meta[property="og:image"]', el => el.content);
    if (ogImage && ogImage.trim()) {
      log.debug('image: found via og:image');
      return ogImage.trim();
    }
  } catch (_) { /* */ }

  // 2. JSON-LD image
  try {
    const ldScripts = await page.$$eval(
      'script[type="application/ld+json"]',
      scripts => scripts.map(s => s.textContent).filter(Boolean)
    );
    for (const raw of ldScripts) {
      try {
        const data = JSON.parse(raw);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const graph = item['@graph'] || [item];
          for (const node of graph) {
            if (node.image) {
              const img = Array.isArray(node.image) ? node.image[0] : node.image;
              const url = typeof img === 'string' ? img : img.url;
              if (url && url.startsWith('http')) {
                log.debug('image: found via JSON-LD');
                return url;
              }
            }
          }
        }
      } catch (_) { /* */ }
    }
  } catch (_) { /* */ }

  // 3. First large product image
  try {
    // Look for product images (typically inside a product-image container, or img with
    // large dimensions, or common product image class patterns)
    const imgUrl = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      // Score images: prefer those with product-like alt text, large sizes, or
      // in product container
      const scored = imgs
        .filter(img => {
          const src = (img.getAttribute('src') || img.getAttribute('data-src') || '');
          // Skip icons, logos, thumbnails, tracking pixels
          if (src.includes('logo') || src.includes('icon') || src.includes('pixel')
              || src.includes('spacer') || src.includes('1x1')) return false;
          const rect = img.getBoundingClientRect();
          return rect.width >= 100 && rect.height >= 100;
        })
        .map(img => {
          let score = 0;
          const alt = (img.alt || '').toLowerCase();
          const src = (img.getAttribute('src') || img.getAttribute('data-src') || '');
          const parentClasses = (img.parentElement?.className || '').toLowerCase();
          const rect = img.getBoundingClientRect();

          if (alt.includes('product') || alt.includes('photo')) score += 3;
          if (parentClasses.includes('product') || parentClasses.includes('image')) score += 2;
          if (rect.width >= 300 && rect.height >= 300) score += 2;
          if (src.startsWith('http')) score += 1;

          return { src, score };
        })
        .sort((a, b) => b.score - a.score);

      return scored.length > 0 ? scored[0].src : null;
    });
    if (imgUrl) {
      log.debug('image: found via img element');
      return imgUrl;
    }
  } catch (_) { /* */ }

  return null;
}

/**
 * Detect product availability from page text.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function extractAvailability(page) {
  try {
    const text = await page.evaluate(() => document.body.innerText.toLowerCase());

    // Explicitly out of stock — these trump everything
    const outPatterns = [
      'out of stock', 'out-of-stock', 'sold out', 'currently unavailable',
      'discontinued', 'no longer available', 'temporarily unavailable',
      'backordered', 'back order', 'pre-order',
    ];
    for (const pattern of outPatterns) {
      if (text.includes(pattern)) {
        // Check if it's negated (e.g., "not out of stock")
        const index = text.indexOf(pattern);
        const before = text.slice(Math.max(0, index - 20), index);
        if (!before.includes('not') && !before.includes("isn't") && !before.includes("won't")) {
          log.debug('availability: out-of-stock pattern matched →', pattern);
          return false;
        }
      }
    }

    // In-stock signals
    const inPatterns = [
      'add to cart', 'buy now', 'add to bag', 'add to basket',
      'in stock', 'in-stock', 'available online', 'ship it',
      'add to shopping cart', 'place order',
    ];
    for (const pattern of inPatterns) {
      if (text.includes(pattern)) {
        log.debug('availability: in-stock pattern matched →', pattern);
        return true;
      }
    }

    // Default — if we found a price but no stock signals, assume available
    log.debug('availability: no clear signal, defaulting to true');
    return true;
  } catch (_) {
    return true;
  }
}

/**
 * Attempt to extract a store-specific item ID from the page.
 * @param {import('playwright').Page} page
 * @returns {Promise<string | null>}
 */
async function extractStoreItemId(page) {
  try {
    // Look in JSON-LD first
    const ldScripts = await page.$$eval(
      'script[type="application/ld+json"]',
      scripts => scripts.map(s => s.textContent).filter(Boolean)
    );
    for (const raw of ldScripts) {
      try {
        const data = JSON.parse(raw);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const graph = item['@graph'] || [item];
          for (const node of graph) {
            if (node.sku) return String(node.sku);
            if (node.productID) return String(node.productID);
            if (node.mpn) return String(node.mpn);
            if (node.gtin) return String(node.gtin);
            if (node.gtin12) return String(node.gtin12);
            if (node.gtin13) return String(node.gtin13);
            if (node.gtin14) return String(node.gtin14);
          }
        }
      } catch (_) { /* */ }
    }

    // Look for common data attributes on the page
    const id = await page.evaluate(() => {
      const el = document.querySelector('[data-product-id], [data-sku], [itemprop="sku"]');
      if (el) return el.getAttribute('data-product-id') || el.getAttribute('data-sku') || el.getAttribute('content') || el.textContent;
      return null;
    });
    if (id) return id.trim();
  } catch (_) { /* */ }

  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Scrape a product page URL for pricing and metadata.
 *
 * Uses Playwright headless Chromium with multiple fallback strategies.
 * Always returns a result object — never throws.
 *
 * @param {string} url - The product URL to scrape.
 * @param {Object} [options] - Optional configuration.
 * @param {string} [options.storeName] - Hint for the store name.
 * @returns {Promise<{
 *   title: string | null,
 *   price: number | null,
 *   currency: string,
 *   available: boolean,
 *   inStorePickup: boolean | null,
 *   shippingEligible: boolean | null,
 *   imageUrl: string | null,
 *   url: string,
 *   storeItemId: string | null,
 *   storeName: string,
 *   source: string,
 * }>}
 */
async function scrapeProduct(url, options = {}) {
  const storeName = options.storeName || 'Unknown Store';

  // Default result
  const result = {
    title: null,
    price: null,
    currency: 'USD',
    available: true,
    inStorePickup: null,
    shippingEligible: null,
    imageUrl: null,
    url,
    storeItemId: null,
    storeName,
    source: 'generic',
  };

  let page;

  try {
    const context = await getContext();
    page = await context.newPage();

    // Set a generous timeout for slow store pages
    page.setDefaultTimeout(30000);

    log.debug(`navigating to ${url}`);
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (!response || (!response.ok() && response.status() >= 400)) {
      log.warn(`page returned status ${response ? response.status() : 'no response'} for ${url}`);
      // Continue anyway — the page may still have useful content
    }

    // Wait a beat for JS-rendered content
    await page.waitForLoadState('networkidle').catch(() => {});
    // Extra delay for aggressive client-side rendering
    await page.waitForTimeout(1500);

    // --- Extract fields in parallel ---
    const [title, { price, currency }, image, available, storeItemId] =
      await Promise.all([
        extractTitle(page),
        extractPrice(page),
        extractImage(page),
        extractAvailability(page),
        extractStoreItemId(page),
      ]);

    result.title = title;
    result.price = price;
    result.currency = currency;
    result.available = available;
    result.imageUrl = image;
    result.storeItemId = storeItemId;

    log.debug('scrape complete', { title, price, currency, available, image, storeItemId });
  } catch (err) {
    // Never throw — return best-effort result
    log.warn(`scrape failed for ${url}: ${err.message}`);
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { scrapeProduct, getBrowser, getContext, closeBrowser, STORE_NAME: 'Generic', STORE_SLUG: 'generic' };
