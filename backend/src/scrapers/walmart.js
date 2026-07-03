'use strict';

const { chromium } = require('playwright');

const STORE_NAME = 'Walmart';
const STORE_SLUG = 'walmart';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const NAV_OPTS = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

/** @type {import('playwright').Browser | null} */
let browser = null;

/**
 * Get or create the singleton Playwright browser instance.
 *
 * Lazily launches a headless Chromium with recommended args for server
 * environments.  All scrapers share one browser; callers must not close it.
 *
 * @returns {Promise<import('playwright').Browser>}
 */
async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--window-size=1280,900',
      ],
    });
  }
  return browser;
}

/**
 * Close the singleton browser instance.
 *
 * Safe to call multiple times — no-ops if already closed / null.
 */
async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch {
      /* ignore close errors */
    }
    browser = null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the Walmart item ID from a product URL.
 *
 * Typical URL shape:  https://www.walmart.com/ip/Product-Name/ITEMID
 * The item ID is the last path segment after `/ip/`.
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractItemId(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.replace(/\/+$/, '').split('/');
    const ipIndex = segments.indexOf('ip');
    if (ipIndex !== -1 && segments.length > ipIndex + 1) {
      return segments[segments.length - 1];
    }
  } catch {
    /* invalid URL */
  }
  return null;
}

/**
 * Wait for critical product content to render (price, title, or a terminal
 * state like out-of-stock / captcha / search results).
 *
 * @param {import('playwright').Page} page
 * @param {number} [timeout=25000]
 */
async function waitForPageSettle(page, timeout) {
  const t = timeout || 25000;
  try {
    await page.waitForFunction(
      () => {
        const addToCart = document.querySelector(
          'button[data-testid="add-to-cart"], [class*="add-to-cart"]'
        );
        const price = document.querySelector(
          'span[itemprop="price"], [data-testid="price"], [class*="price-group"]'
        );
        const title = document.querySelector(
          'h1[itemprop="name"], [data-testid="product-title"]'
        );
        const searchContent = document.querySelector(
          '[data-testid="search-content"], [class*="search-result"]'
        );
        const captcha = document.querySelector(
          '#px-captcha, .g-recaptcha, iframe[src*="captcha"]'
        );
        return !!(addToCart || price || title || searchContent || captcha);
      },
      { timeout: t }
    );
  } catch {
    /* timeout — continue with whatever is on the page */
  }
}

/**
 * Detect CAPTCHA / bot challenge pages.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectCaptcha(page) {
  const el = await page.$(
    '#px-captcha, iframe[src*="captcha"], .g-recaptcha, [class*="captcha"]'
  );
  if (el) return true;

  const text = await page.evaluate(
    () => document.body?.innerText?.substring(0, 600) || ''
  );
  if (/captcha|verify (you are|your)|enable.*javascript/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * Check whether the current page is a Walmart search results page,
 * which happens when the product URL is invalid / redirects.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isSearchResultsPage(page) {
  const url = page.url();
  if (/\/search[?/]/.test(url)) return true;

  const el = await page.$(
    '[data-testid="search-content"], [class*="search-result"], [data-testid="search-page"]'
  );
  return !!el;
}

// ─── Text extractors ────────────────────────────────────────────────────────

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<string>}
 */
async function extractTitle(page) {
  const selectors = [
    'h1[itemprop="name"]',
    '[data-testid="product-title"]',
    'meta[property="og:title"]',
    'h1',
  ];
  for (const sel of selectors) {
    try {
      if (sel.startsWith('meta')) {
        const content = await page.getAttribute(sel, 'content');
        if (content) return content.trim();
      } else {
        const text = await page.textContent(sel);
        if (text) return text.trim();
      }
    } catch {
      continue;
    }
  }
  // Fallback: document title
  return page.title();
}

/**
 * @param {import('playwright').Page} page
 * @returns {Promise<{ price: number | null, currency: string }>}
 */
async function extractPrice(page) {
  let currency = 'USD';

  // 1) semantic price span with `content` attribute (Walmart's primary)
  try {
    const priceSpan = await page.$('span[itemprop="price"]');
    if (priceSpan) {
      const content = await priceSpan.getAttribute('content');
      if (content) {
        const parsed = parseFloat(content);
        if (!Number.isNaN(parsed)) return { price: parsed, currency };
      }
      // fallback to text content
      const text = await priceSpan.textContent();
      if (text) {
        const parsed = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (!Number.isNaN(parsed)) return { price: parsed, currency };
      }
    }
  } catch {
    /* try next */
  }

  // 2) data-testid="price"
  try {
    const priceEl = await page.$('[data-testid="price"]');
    if (priceEl) {
      const text = await priceEl.textContent();
      if (text) {
        const parsed = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (!Number.isNaN(parsed)) return { price: parsed, currency };
      }
    }
  } catch {
    /* try next */
  }

  // 3) Walmart's price-group pattern (inline SVG + text)
  try {
    const priceGroup = await page.$('[class*="price-group"]');
    if (priceGroup) {
      const text = await priceGroup.textContent();
      if (text) {
        const parsed = parseFloat(text.replace(/[^0-9.]/g, ''));
        if (!Number.isNaN(parsed)) return { price: parsed, currency };
      }
    }
  } catch {
    /* try next */
  }

  // 4) Any large visible price on the page (heuristic fallback)
  try {
    const priceText = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('span, div'));
      for (const el of all) {
        const t = (el.textContent || '').trim();
        const m = t.match(/^\$?([0-9]+\.[0-9]{2})$/);
        if (m) return m[0];
      }
      return null;
    });
    if (priceText) {
      const parsed = parseFloat(priceText.replace(/[^0-9.]/g, ''));
      if (!Number.isNaN(parsed)) return { price: parsed, currency };
    }
  } catch {
    /* give up */
  }

  return { price: null, currency };
}

/**
 * Determine availability: true if an "Add to cart" button is present and
 * enabled, false otherwise.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function extractAvailability(page) {
  // First check for explicit out-of-stock indicators
  const oosText = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    // Check for out-of-stock messages
    return /out of stock|sold out|currently unavailable/i.test(text);
  });
  if (oosText) return false;

  // Check for an enabled "Add to cart" button
  try {
    const addToCartBtns = await page.$$(
      'button[data-testid="add-to-cart"], button:has-text("Add to cart")'
    );
    for (const btn of addToCartBtns) {
      const disabled = await btn.getAttribute('disabled');
      const cls = await btn.getAttribute('class');
      if (disabled !== null) return false;
      if (cls && /disabled/i.test(cls)) return false;
      // Button exists and is likely enabled
      return true;
    }
  } catch {
    /* try next */
  }

  // Check for pre-order / "Add to list" only — those are still orderable
  try {
    const preorder = await page.$(
      'button:has-text("Pre-order"), button:has-text("Add to list")'
    );
    if (preorder) return true;
  } catch {
    /* give up */
  }

  return false;
}

/**
 * Extract fulfilment options from the page.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ inStorePickup: boolean, shippingEligible: boolean }>}
 */
async function extractFulfillment(page) {
  let inStorePickup = false;
  let shippingEligible = false;

  try {
    const text = await page.evaluate(() => document.body?.innerText || '');

    // Walmart displays "Free pickup" / "Pickup" / "Pickup today" in the
    // delivery options section for items eligible for in-store or curbside pickup.
    if (
      /\bFree pickup\b/i.test(text) ||
      /\bPickup today\b/i.test(text) ||
      /\bPickup\s+(from|at|available)\b/i.test(text)
    ) {
      inStorePickup = true;
    }

    // Shipping badges: "Free shipping" / "Shipping" / "Get it by"
    if (
      /\bFree shipping\b/i.test(text) ||
      /\bShipping\s+(to|from|available)\b/i.test(text) ||
      /\bGet it by\b/i.test(text) ||
      /\bArrives\s+\d+/i.test(text)
    ) {
      shippingEligible = true;
    }
  } catch {
    /* fall through */
  }

  // Additionally check for fulfillment badge data attributes
  try {
    const badgeText = await page.evaluate(() => {
      const badges = Array.from(
        document.querySelectorAll(
          '[class*="fulfillment"] span, [data-testid*="fulfillment"] span, [class*="delivery-option"]'
        )
      );
      return badges.map((b) => b.textContent || '').join(' ');
    });

    if (/\bPickup\b/i.test(badgeText)) inStorePickup = true;
    if (/\bShipping\b/i.test(badgeText) || /\bShip\b/i.test(badgeText)) {
      shippingEligible = true;
    }
  } catch {
    /* done */
  }

  return { inStorePickup, shippingEligible };
}

/**
 * Extract the primary product image URL.
 *
 * Order of preference:
 *   1. og:image meta tag
 *   2. Hero / main product image (data-testid="hero-image", etc.)
 *   3. First img within the image gallery
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
async function extractImage(page) {
  // meta[property="og:image"]
  try {
    const ogImage = await page.getAttribute(
      'meta[property="og:image"]',
      'content'
    );
    if (ogImage) return ogImage;
  } catch {
    /* try next */
  }

  // Hero image by test id or CSS class
  try {
    const heroSelectors = [
      '[data-testid="hero-image"]',
      '[data-testid="media-thumbnail"] img',
      '[class*="prod-hero"] img',
      '[class*="product-image-carousel"] img',
    ];
    for (const sel of heroSelectors) {
      const src = await page.getAttribute(sel, 'src');
      if (src) return src;
    }
  } catch {
    /* try next */
  }

  // Any large image in the main content area
  try {
    const src = await page.evaluate(() => {
      const imgs = Array.from(
        document.querySelectorAll('main img[src*="walmart"][src*="/images/"], main img[src*="/images/"]')
      );
      for (const img of imgs) {
        const s = img.getAttribute('src');
        if (s && !s.includes('icon') && !s.includes('logo')) return s;
      }
      return null;
    });
    if (src) return src;
  } catch {
    /* give up */
  }

  return null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Scrape a single Walmart product page.
 *
 * Navigates to the product URL with a headless Chromium browser, waits for
 * dynamic content to render, and extracts structured product data.
 *
 * Handles CAPTCHA detection, product-not-found redirects, and multiple page
 * layouts with fallback selectors.
 *
 * @param {string} url - Walmart product URL (e.g. https://www.walmart.com/ip/...)
 * @returns {Promise<{
 *   title: string,
 *   price: number|null,
 *   currency: string,
 *   available: boolean,
 *   inStorePickup: boolean,
 *   shippingEligible: boolean,
 *   imageUrl: string|null,
 *   url: string,
 *   storeItemId: string|null,
 *   storeName: string
 * }>}
 */
async function scrapeProduct(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('A valid Walmart URL is required');
  }

  const itemId = extractItemId(url);
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();

  try {
    // Navigate and wait for network to settle
    await page.goto(url, NAV_OPTS);

    // Detect CAPTCHA — throw immediately
    if (await detectCaptcha(page)) {
      throw new Error('CAPTCHA challenge encountered — cannot scrape');
    }

    // Detect redirect to search results (product not found)
    if (await isSearchResultsPage(page)) {
      throw new Error('Product not found — redirected to search results');
    }

    // Wait for key product content to appear
    await waitForPageSettle(page);

    // Extract all fields in parallel where possible
    const [title, priceData, available, fulfillment, imageUrl] =
      await Promise.all([
        extractTitle(page),
        extractPrice(page),
        extractAvailability(page),
        extractFulfillment(page),
        extractImage(page),
      ]);

    return {
      title,
      price: priceData.price,
      currency: priceData.currency,
      available,
      inStorePickup: fulfillment.inStorePickup,
      shippingEligible: fulfillment.shippingEligible,
      imageUrl,
      url: page.url(),
      storeItemId: itemId,
      storeName: STORE_NAME,
    };
  } finally {
    await page.close();
    await context.close();
  }
}

module.exports = { scrapeProduct, getBrowser, closeBrowser, STORE_NAME, STORE_SLUG };
