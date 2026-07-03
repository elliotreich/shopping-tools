'use strict';

const { chromium } = require('playwright');

const STORE_NAME = 'Target';
const STORE_SLUG = 'target';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const NAV_OPTS = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
};

// Target TCIN appears in URLs as /-/A-{TCIN} or /-/A_{TCIN}
const TCIN_URL_RE = /\/-\/A[_-](\d+)/i;

/** @type {import('playwright').Browser | null} */
let browser = null;

/**
 * Get or create the singleton Playwright browser instance.
 *
 * Lazily launches a headless Chromium. All Target scrapes share one browser;
 * callers must not close it directly — use `closeBrowser()` instead.
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
        '--window-size=1920,1080',
      ],
    });
  }
  return browser;
}

/**
 * Close the singleton browser instance.
 * Safe to call multiple times.
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
 * Parse a price string like "$448.00" or "Sale $448.00" to a number.
 * @param {string} text
 * @returns {number|null}
 */
function parsePrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) || val <= 0 ? null : val;
}

/**
 * Wait until the product page has rendered its critical content:
 * price, title, add-to-cart button, or a terminal state (CAPTCHA / error page).
 *
 * @param {import('playwright').Page} page
 * @param {number} [timeout=20000]
 */
async function waitForPageSettle(page, timeout) {
  const t = timeout || 20000;
  try {
    await page.waitForFunction(
      () => {
        const price = document.querySelector(
          '[data-test="product-price"], [data-test="current-price"], span[class*="price"]'
        );
        const title = document.querySelector(
          '[data-test="product-title"], h1[class*="title"]'
        );
        const addToCart = document.querySelector(
          '[data-test="addToCartButton"], button[id*="addToCart"]'
        );
        const captcha = document.querySelector(
          '#px-captcha, .challenge-form, #cf-challenge-form, iframe[src*="captcha"]'
        );
        const errorPage = document.querySelector(
          '[data-test="error-page"], [class*="errorPage"]'
        );
        return !!(price || title || addToCart || captcha || errorPage);
      },
      { timeout: t }
    );
  } catch {
    /* timeout — continue with whatever the page rendered */
  }
}

/**
 * Detect CAPTCHA / bot-challenge / block pages.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectCaptcha(page) {
  const el = await page.$(
    '#px-captcha, .challenge-form, #cf-challenge-form, #turnstile-wrapper, iframe[src*="captcha"]'
  );
  if (el) return true;

  try {
    const title = (await page.title()).toLowerCase();
    if (/robot|captcha|verify|security check|access denied/i.test(title)) return true;
  } catch {
    /* ignore */
  }

  try {
    const text = await page.evaluate(
      () => document.body?.innerText?.substring(0, 800) || ''
    );
    if (
      /please verify you are a human|are you a robot|enable.*javascript|checking your browser/i.test(
        text
      )
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * Normalize a Target URL to www.target.com with https.
 * @param {string} rawUrl
 * @returns {string}
 */
function normalizeUrl(rawUrl) {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'target.com') parsed.hostname = 'www.target.com';
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * Extract the TCIN (Target's internal product ID) from the URL or page data.
 * @param {string} url
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
async function extractTcin(url, page) {
  // 1) URL pattern: /-/A-{TCIN}
  const urlMatch = url.match(TCIN_URL_RE);
  if (urlMatch) return urlMatch[1];

  // 2) data-test elements on the page
  try {
    const tcin = await page.evaluate(() => {
      const selectors = [
        '[data-test="product-details-tcin"]',
        '[data-test="tcin"]',
        '[data-test="product-tcin"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const m = el.textContent.match(/\d{6,}/);
          if (m) return m[0];
        }
      }
      return null;
    });
    if (tcin) return tcin;
  } catch {
    /* try next */
  }

  // 3) JSON-LD structured data
  try {
    const sku = await page.evaluate(() => {
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]'
      );
      for (const s of scripts) {
        try {
          const json = JSON.parse(s.textContent);
          if (json['@type'] === 'Product') return json.sku || json.mpn || null;
        } catch {
          /* skip malformed */
        }
      }
      return null;
    });
    if (sku) return sku;
  } catch {
    /* give up */
  }

  return null;
}

/**
 * Extract product title from the page with multiple fallback strategies.
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
async function extractTitle(page) {
  try {
    const title = await page.evaluate(() => {
      // Primary selectors
      const selectors = [
        '[data-test="product-title"]',
        'h1[class*="title"]',
        '[data-test="product-title-container"] h1',
        'h1[data-automation-id="product-title"]',
        'meta[property="og:title"]',
      ];
      for (const sel of selectors) {
        if (sel.startsWith('meta')) {
          const el = document.querySelector(sel);
          if (el) {
            const c = el.getAttribute('content');
            if (c) return c.trim();
          }
        } else {
          const el = document.querySelector(sel);
          if (el) {
            const t = el.textContent.trim();
            if (t) return t;
          }
        }
      }
      return null;
    });
    if (title) return title;
  } catch {
    /* fall through */
  }

  // Fallback: JSON-LD
  try {
    const name = await page.evaluate(() => {
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]'
      );
      for (const s of scripts) {
        try {
          const json = JSON.parse(s.textContent);
          if (json['@type'] === 'Product' && json.name) return json.name;
        } catch {
          /* skip */
        }
      }
      return null;
    });
    if (name) return name;
  } catch {
    /* fall through */
  }

  // Fallback: document title
  try {
    const t = await page.title();
    if (t) return t.replace(/\s*[:|]\s*Target.*$/i, '').trim();
  } catch {
    /* give up */
  }

  return null;
}

/**
 * Extract the current price from the page.
 *
 * Order of preference:
 *  1. [data-test="product-price"]
 *  2. [data-test="current-price"]
 *  3. .h-text-grayDarkest span[class*="price"]
 *  4. JSON-LD offers.price
 *  5. First $XX.XX string found in the page body
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<number|null>}
 */
async function extractPrice(page) {
  // DOM selectors
  try {
    const price = await page.evaluate(() => {
      const selectors = [
        '[data-test="product-price"]',
        '[data-test="current-price"]',
        '.h-text-grayDarkest span[class*="price"]',
        'span[data-test="product-price"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.textContent.replace(/[,]/g, '');
          const m = text.match(/[\d]+\.\d{2}/);
          if (m) {
            const n = parseFloat(m[0]);
            if (!isNaN(n) && n > 0) return n;
          }
        }
      }
      return null;
    });
    if (price !== null) return price;
  } catch {
    /* fall through */
  }

  // JSON-LD
  try {
    const jsonPrice = await page.evaluate(() => {
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]'
      );
      for (const s of scripts) {
        try {
          const json = JSON.parse(s.textContent);
          if (json['@type'] === 'Product' && json.offers) {
            const offers = Array.isArray(json.offers) ? json.offers : [json.offers];
            for (const o of offers) {
              if (o.price && o.price > 0) return o.price;
            }
          }
        } catch {
          /* skip */
        }
      }
      return null;
    });
    if (jsonPrice !== null) return jsonPrice;
  } catch {
    /* fall through */
  }

  // Heuristic: scan page for a dollar amount
  try {
    const bodyText = await page.evaluate(() => document.body.innerText);
    const lines = bodyText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('$')) {
        const m = trimmed.replace(/[,]/g, '').match(/([\d]+\.\d{2})/);
        if (m) {
          const n = parseFloat(m[1]);
          if (!isNaN(n) && n > 0 && n < 100000) return n;
        }
      }
    }
  } catch {
    /* give up */
  }

  return null;
}

/**
 * Determine whether the product is in stock / available for purchase.
 *
 * Checks the "Add to cart" button state, then scans body text for
 * out-of-stock signals.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean|null>}  true/false, or null if uncertain
 */
async function extractAvailability(page) {
  // Check Add-to-Cart button state
  try {
    const buttonState = await page.evaluate(() => {
      const selectors = [
        '[data-test="addToCartButton"]',
        '[data-test="add-to-cart-button"]',
        'button[data-test="addToCart"]',
        'button[id*="addToCart"]',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn) {
          const disabled =
            btn.disabled ||
            btn.getAttribute('aria-disabled') === 'true' ||
            btn.getAttribute('disabled') !== null;
          const text = (btn.textContent || '').toLowerCase().trim();
          const soldOutKeywords = [
            'sold out',
            'out of stock',
            'coming soon',
            'unavailable',
            'notify me',
          ];
          const isSoldOut = soldOutKeywords.some((kw) => text.includes(kw));
          return { disabled, isSoldOut };
        }
      }
      return null;
    });

    if (buttonState) {
      if (buttonState.disabled || buttonState.isSoldOut) return false;
      return true;
    }
  } catch {
    /* fall through */
  }

  // Body-text heuristics
  try {
    const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
    const soldOutPatterns = [
      /this item is currently out of stock/i,
      /this item is no longer available/i,
      /currently unavailable/i,
      /sold out online/i,
    ];
    for (const p of soldOutPatterns) {
      if (p.test(bodyText)) return false;
    }
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * Determine whether in-store pickup is available for this item.
 *
 * Target PDPs display a "Pickup & delivery" section for items that
 * support pickup. Without a ZIP code we can't confirm stock at a
 * specific store, but the presence of the section confirms eligibility.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function extractPickupAvailability(page) {
  try {
    const result = await page.evaluate(() => {
      // Check for a dedicated pickup options section
      const sectionSelectors = [
        '[data-test="pickupOptions"]',
        '[data-test^="pickup"]',
        '[data-test="fulfillment-options"]',
        'section[data-test="pickup-availability"]',
      ];
      for (const sel of sectionSelectors) {
        const section = document.querySelector(sel);
        if (section) {
          const text = section.textContent.toLowerCase();
          const unavailableSignals = [
            'unavailable for pickup',
            'not available for pickup',
            'pickup unavailable',
            'this item cannot be picked up',
            'not eligible for pickup',
          ];
          for (const signal of unavailableSignals) {
            if (text.includes(signal)) return false;
          }
          // Section exists and doesn't say unavailable — pickup is supported
          return true;
        }
      }
      return null;
    });
    if (result !== null) return result;
  } catch {
    /* fall through */
  }

  // Broader page-text heuristics
  try {
    const text = await page.evaluate(() => document.body.innerText.toLowerCase());
    const indicators = [
      /how you.?ll get it/i,
      /pick.?up options/i,
      /pick it up/i,
      /in.?store pickup/i,
      /check stores/i,
      /available for pickup/i,
    ];
    for (const p of indicators) {
      if (p.test(text)) return true;
    }
  } catch {
    /* ignore */
  }

  return false;
}

/**
 * Determine whether the product is eligible for shipping.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function extractShippingEligibility(page) {
  // Check for explicit shipping section
  try {
    const hasShippingSection = await page.$(
      '[data-test="shippingOption"], [data-test="fulfillment-shipping"]'
    );
    if (hasShippingSection) return true;
  } catch {
    /* fall through */
  }

  // Check body text for shipping-unavailable signals
  try {
    const text = await page.evaluate(() => document.body.innerText.toLowerCase());
    const unavailablePatterns = [
      /not available for shipping/i,
      /cannot be shipped/i,
      /shipping not available/i,
      /in-store only/i,
    ];
    for (const p of unavailablePatterns) {
      if (p.test(text)) return false;
    }
  } catch {
    /* ignore */
  }

  // If Add to Cart exists, it's generally shippable
  try {
    const hasAddToCart = await page.$(
      '[data-test="addToCartButton"], button:has-text("Add to cart")'
    );
    if (hasAddToCart) return true;
  } catch {
    /* fall through */
  }

  return true;
}

/**
 * Extract the primary product image URL.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>}
 */
async function extractImage(page) {
  try {
    const imageUrl = await page.evaluate(() => {
      const selectors = [
        '[data-test="product-image"] img',
        '[data-test="main-product-image"] img',
        'img[data-test="product-image-asset"]',
        'div[class*="mainImage"] img',
        'picture[data-test="product-image"] img',
        'meta[property="og:image"]',
      ];
      for (const sel of selectors) {
        if (sel.startsWith('meta')) {
          const el = document.querySelector(sel);
          if (el) {
            const c = el.getAttribute('content');
            if (c) return c;
          }
        } else {
          const el = document.querySelector(sel);
          if (el) {
            const src =
              el.getAttribute('src') || el.getAttribute('data-src') || '';
            if (src && !src.startsWith('data:')) return src;
          }
        }
      }
      return null;
    });
    if (imageUrl) return imageUrl;
  } catch {
    /* fall through */
  }

  // JSON-LD fallback
  try {
    const jsonImage = await page.evaluate(() => {
      const scripts = document.querySelectorAll(
        'script[type="application/ld+json"]'
      );
      for (const s of scripts) {
        try {
          const json = JSON.parse(s.textContent);
          if (json['@type'] === 'Product' && json.image) {
            if (typeof json.image === 'string') return json.image;
            if (Array.isArray(json.image) && json.image.length > 0) {
              if (typeof json.image[0] === 'string') return json.image[0];
            }
          }
        } catch {
          /* skip */
        }
      }
      return null;
    });
    if (jsonImage) return jsonImage;
  } catch {
    /* give up */
  }

  return null;
}

/**
 * Check whether the page is a 404 / product-not-found page.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectNotFound(page) {
  try {
    const title = await page.title();
    if (/404|page not found/i.test(title)) return true;
  } catch {
    /* ignore */
  }
  try {
    const url = page.url();
    if (url.includes('/not-found') || url.includes('/error')) return true;
  } catch {
    /* ignore */
  }
  try {
    const text = await page.evaluate(
      () => document.body?.innerText?.substring(0, 300) || ''
    );
    if (
      /the web address you entered is not a functioning page/i.test(text) ||
      /this page is not available/i.test(text)
    ) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Scrape a Target product page for price comparison data.
 *
 * Navigates to the product URL with a headless Chromium browser and
 * extracts the title, price, availability, fulfilment options, image,
 * and TCIN from the rendered page.
 *
 * @param {string} url - Target product page URL
 * @returns {Promise<{
 *   title: string|null,
 *   price: number|null,
 *   currency: string,
 *   available: boolean|null,
 *   inStorePickup: boolean,
 *   shippingEligible: boolean,
 *   imageUrl: string|null,
 *   url: string,
 *   storeItemId: string|null,
 *   storeName: string,
 *   error?: string,
 * }>}
 */
async function scrapeProduct(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('A valid Target URL is required');
  }

  const normalizedUrl = normalizeUrl(url);
  const b = await getBrowser();
  const context = await b.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    geolocation: { longitude: -93.265, latitude: 44.9778 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();

  // Additional headers to look like a real browser
  await page.setExtraHTTPHeaders({
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  });

  try {
    // Navigate
    try {
      await page.goto(normalizedUrl, NAV_OPTS);
    } catch (navErr) {
      return {
        title: null,
        price: null,
        currency: 'USD',
        available: false,
        inStorePickup: false,
        shippingEligible: false,
        imageUrl: null,
        url: normalizedUrl,
        storeItemId: null,
        storeName: STORE_NAME,
        error: 'NAVIGATION_FAILED',
      };
    }

    // CAPTCHA / block check
    if (await detectCaptcha(page)) {
      return {
        title: null,
        price: null,
        currency: 'USD',
        available: false,
        inStorePickup: false,
        shippingEligible: false,
        imageUrl: null,
        url: normalizedUrl,
        storeItemId: null,
        storeName: STORE_NAME,
        error: 'CAPTCHA_BLOCKED',
      };
    }

    // 404 check
    if (await detectNotFound(page)) {
      return {
        title: null,
        price: null,
        currency: 'USD',
        available: false,
        inStorePickup: false,
        shippingEligible: false,
        imageUrl: null,
        url: normalizedUrl,
        storeItemId: null,
        storeName: STORE_NAME,
        error: 'NOT_FOUND',
      };
    }

    // Wait for critical content to render
    await waitForPageSettle(page);
    // Extra settle time for React hydration
    await page.waitForTimeout(1500);

    // Extract all fields
    const [title, price, available, pickup, shipping, imageUrl, storeItemId] =
      await Promise.all([
        extractTitle(page),
        extractPrice(page),
        extractAvailability(page),
        extractPickupAvailability(page),
        extractShippingEligibility(page),
        extractImage(page),
        extractTcin(normalizedUrl, page),
      ]);

    return {
      title,
      price,
      currency: 'USD',
      available,
      inStorePickup: pickup,
      shippingEligible: shipping,
      imageUrl,
      url: page.url(),
      storeItemId,
      storeName: STORE_NAME,
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

module.exports = { scrapeProduct, getBrowser, closeBrowser, STORE_NAME, STORE_SLUG };
