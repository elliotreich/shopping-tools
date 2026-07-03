'use strict';

const { chromium } = require('playwright');

const STORE_NAME = 'Amazon';
const STORE_SLUG = 'amazon';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** @type {import('playwright').Browser|null} */
let browser = null;
/** @type {import('playwright').BrowserContext|null} */
let context = null;

/**
 * Get or create the singleton browser instance.
 * Launches headless Chromium on first call, reuses it thereafter.
 * @returns {Promise<import('playwright').Browser>}
 */
async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
    ],
  });
  return browser;
}

/**
 * Close the singleton browser instance and its context.
 * Safe to call multiple times.
 */
async function closeBrowser() {
  if (context) {
    try {
      await context.close();
    } catch {
      // already closed
    }
    context = null;
  }
  if (browser) {
    try {
      await browser.close();
    } catch {
      // already closed
    }
    browser = null;
  }
}

/**
 * Create or reuse a browser context with sensible defaults.
 * Contexts isolate cookies/sessions — reuse keeps session data.
 * @returns {Promise<import('playwright').BrowserContext>}
 */
async function getContext() {
  await getBrowser();
  if (context && !context.isClosed()) return context;
  context = await browser.newContext({
    viewport: { width: 800, height: 600 },
    userAgent: USER_AGENT,
    locale: 'en-US',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
  });
  return context;
}

/**
 * Extract the ASIN (Amazon Standard Identification Number) from a URL.
 * @param {string} url
 * @returns {string|null}
 */
function extractAsin(url) {
  // Match /dp/ASIN, /product/ASIN, /gp/product/ASIN, /exec/obidos/ASIN
  const m1 = url.match(
    /\/(?:dp|product|gp\/product|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i
  );
  if (m1) return m1[1].toUpperCase();

  // Some short URLs: amazon.com/B00EPWC30O/
  const m2 = url.match(/amazon\.[a-z.]+\/([A-Z0-9]{10})(?:[/?]|$)/i);
  if (m2) return m2[1].toUpperCase();

  // ASIN in query param
  const m3 = url.match(/[?&]asin=([A-Z0-9]{10})(?:&|$)/i);
  if (m3) return m3[1].toUpperCase();

  return null;
}

/**
 * Extract the domain name from an Amazon URL (e.g. "amazon.co.uk").
 * @param {string} url
 * @returns {string}
 */
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'amazon.com';
  }
}

/**
 * Normalize an Amazon URL or bare ASIN into a full product URL.
 * @param {string} urlOrAsin
 * @returns {{ url: string, asin: string|null }}
 */
function normalizeInput(urlOrAsin) {
  const trimmed = urlOrAsin.trim();

  // Already a URL — clean it up
  if (/^https?:\/\//i.test(trimmed)) {
    const asin = extractAsin(trimmed);
    if (asin) {
      const domain = extractDomain(trimmed);
      return { url: `https://www.${domain}/dp/${asin}/`, asin };
    }
    return { url: trimmed, asin: null };
  }

  // Bare ASIN (10-character alphanumeric)
  if (/^[A-Z0-9]{10}$/i.test(trimmed)) {
    const asin = trimmed.toUpperCase();
    return { url: `https://www.amazon.com/dp/${asin}/`, asin };
  }

  // Could be an "amzn" or other short code — treat as search
  return { url: `https://www.amazon.com/dp/${trimmed}/`, asin: null };
}

/**
 * Parse a price string like "$448.00" or "CDN$ 599.99" into a number.
 * Returns null if parsing fails.
 * @param {string} text
 * @returns {number|null}
 */
function parsePrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

/**
 * Detect currency from a price string and URL domain.
 * @param {string} priceText
 * @param {string} domain
 * @returns {string}
 */
function detectCurrency(priceText, domain) {
  if (priceText.includes('£')) return 'GBP';
  if (priceText.includes('€')) return 'EUR';
  if (priceText.includes('CDN$') || priceText.includes('C$')) return 'CAD';
  if (priceText.includes('¥')) {
    return domain.includes('amazon.co.jp') ? 'JPY' : 'CNY';
  }
  if (priceText.includes('R$')) return 'BRL';
  if (priceText.includes('AU$') || priceText.includes('A$')) return 'AUD';
  if (priceText.includes('MX$')) return 'MXN';
  return 'USD';
}

/**
 * Detect a CAPTCHA / bot-challenge page.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectCaptcha(page) {
  const url = page.url().toLowerCase();
  if (url.includes('captcha')) return true;

  try {
    const text = await page.textContent('body');
    return (
      text.includes('Enter the characters') ||
      text.includes('Type the characters') ||
      text.includes("Sorry! We couldn't process your request") ||
      text.includes('To discuss automated access') ||
      text.includes('Enter the text shown in the image')
    );
  } catch {
    return false;
  }
}

/**
 * Detect a 404 / "Page Not Found" page.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function detectNotFound(page) {
  try {
    const title = await page.title();
    if (/404|page not found/i.test(title)) return true;
  } catch {
    // ignore
  }

  try {
    const text = await page.textContent('body');
    return (
      text.includes('Page Not Found') ||
      text.includes('The web address you entered is not a functioning page') ||
      text.includes('This page is not available') ||
      text.includes('Sorry, we just need to make sure') // sometimes shows on captcha
    );
  } catch {
    return false;
  }
}

/**
 * Scrape an Amazon product page for price and metadata.
 *
 * @param {string} urlOrAsin - Amazon product URL or bare ASIN
 * @returns {Promise<{
 *   title: string|null,
 *   price: number|null,
 *   currency: string,
 *   available: boolean,
 *   inStorePickup: boolean,
 *   shippingEligible: boolean,
 *   imageUrl: string|null,
 *   url: string,
 *   storeItemId: string|null,
 *   storeName: string,
 *   error?: string,
 * }>}
 */
async function scrapeProduct(urlOrAsin) {
  const { url, asin } = normalizeInput(urlOrAsin);
  const storeItemId = asin || extractAsin(url);

  const ctx = await getContext();
  const page = await ctx.newPage();

  try {
    // Navigate to the product page
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    } catch (navErr) {
      // Navigation itself may time out or fail
      return {
        title: null,
        price: null,
        currency: 'USD',
        available: false,
        inStorePickup: false,
        shippingEligible: false,
        imageUrl: null,
        url,
        storeItemId,
        storeName: STORE_NAME,
        error: 'NAVIGATION_FAILED',
      };
    }

    // Check for blocking / CAPTCHA
    if (await detectCaptcha(page)) {
      return {
        title: null,
        price: null,
        currency: 'USD',
        available: false,
        inStorePickup: false,
        shippingEligible: false,
        imageUrl: null,
        url,
        storeItemId,
        storeName: STORE_NAME,
        error: 'CAPTCHA_BLOCKED',
      };
    }

    // Check for 404
    if (await detectNotFound(page)) {
      return {
        title: null,
        price: null,
        currency: 'USD',
        available: false,
        inStorePickup: false,
        shippingEligible: false,
        imageUrl: null,
        url,
        storeItemId,
        storeName: STORE_NAME,
        error: 'NOT_FOUND',
      };
    }

    // Wait for the product title — primary indicator of a loaded product page
    try {
      await page.waitForSelector('#productTitle', { timeout: 15000 });
    } catch {
      // Title never appeared; page may be unusual but continue anyway
      await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});
    }

    // ── Title ────────────────────────────────────────────────────────
    let title = null;
    try {
      title = (await page.$eval('#productTitle', (el) => el.textContent.trim())).replace(
        /\s+/g,
        ' '
      );
    } catch {
      // fetch from document title as fallback
      try {
        title = await page.title();
      } catch {
        // give up
      }
    }

    // ── Price (with fallback chain) ──────────────────────────────────
    let price = null;
    let currency = 'USD';

    // Strategy 1: #corePrice_feature_div .a-price .a-offscreen
    //            (accessible/hidden price text — most reliable)
    try {
      const priceText = await page.$eval(
        '#corePrice_feature_div .a-price .a-offscreen',
        (el) => el.textContent.trim()
      );
      price = parsePrice(priceText);
      if (priceText) currency = detectCurrency(priceText, extractDomain(url));
    } catch {
      // fall through
    }

    // Strategy 2: #price_inside_buybox (older layout)
    if (price === null) {
      try {
        const priceText = await page.$eval(
          '#price_inside_buybox',
          (el) => el.textContent.trim()
        );
        price = parsePrice(priceText);
        if (priceText) currency = detectCurrency(priceText, extractDomain(url));
      } catch {
        // fall through
      }
    }

    // Strategy 3: .a-price-whole + .a-price-fraction
    if (price === null) {
      try {
        const whole = await page.$eval('.a-price-whole', (el) =>
          el.textContent.trim()
        );
        const fraction = await page
          .$eval('.a-price-fraction', (el) => el.textContent.trim())
          .catch(() => '00');
        const cleanedWhole = whole.replace(/[^0-9]/g, '');
        const cleanedFraction = fraction.replace(/[^0-9]/g, '').padEnd(2, '0');
        const parsed = parseFloat(cleanedWhole + '.' + cleanedFraction);
        if (!isNaN(parsed)) price = parsed;
      } catch {
        // fall through
      }
    }

    // Strategy 4: Any .a-price span with "price" or "our price" in parent
    if (price === null) {
      try {
        const priceText = await page.$eval(
          '.a-price .a-offscreen:not(.a-text-price *)',
          (el) => el.textContent.trim()
        );
        price = parsePrice(priceText);
      } catch {
        // give up
      }
    }

    // ── Availability ────────────────────────────────────────────────
    let available = true;
    try {
      const outOfStockEl = await page.$('#outOfStock');
      if (outOfStockEl) {
        // Only mark unavailable if the element is actually visible on screen
        // (hidden outOfStock divs exist in the DOM for variants)
        const visible = await outOfStockEl.isVisible();
        if (visible) available = false;
      }
    } catch {
      // ignore
    }

    // Check body text for negative availability signals (only if still available)
    if (available) {
      try {
        const bodyText = await page.textContent('body');
        const unavailablePatterns = [
          /currently unavailable/i,
          /we don't know when or if/i,
          /temporarily out of stock/i,
          /this item is no longer available/i,
          /have been discontinued/i,
        ];
        if (unavailablePatterns.some((p) => p.test(bodyText))) {
          available = false;
        }
      } catch {
        // ignore
      }
    }

    // Check #availability span for positive/negative signals (overrides above)
    try {
      const availText = await page
        .$eval('#availability span', (el) => el.textContent.trim())
        .catch(() => null);
      if (availText) {
        if (/in stock|only \d+ left|usually ships/i.test(availText)) {
          available = true;
        } else if (
          /temporarily out of stock|currently unavailable/i.test(availText)
        ) {
          available = false;
        }
      }
    } catch {
      // ignore
    }

    // ── Shipping eligibility ────────────────────────────────────────
    let shippingEligible = true;
    try {
      const bodyText = (await page.textContent('body')).toLowerCase();
      if (
        bodyText.includes('this item cannot be shipped') ||
        bodyText.includes('does not ship') ||
        bodyText.includes('shipping not available') ||
        bodyText.includes('this item is restricted')
      ) {
        shippingEligible = false;
      }
    } catch {
      // default to true
    }

    // ── Image URL ───────────────────────────────────────────────────
    let imageUrl = null;
    try {
      const imgEl =
        (await page.$('#landingImage')) ||
        (await page.$('#imgTagWrapperId img')) ||
        (await page.$('.a-dynamic-image'));
      if (imgEl) {
        imageUrl =
          (await imgEl.getAttribute('src').catch(() => null)) ||
          (await imgEl.getAttribute('data-old-hires').catch(() => null)) ||
          (await imgEl.getAttribute('data-a-dynamic-image').catch(() => null));

        // data-a-dynamic-image is a JSON object: { "url": [w,h], ... }
        if (imageUrl && imageUrl.startsWith('{')) {
          try {
            const parsed = JSON.parse(imageUrl);
            const urls = Object.keys(parsed);
            if (urls.length > 0) imageUrl = urls[0];
          } catch {
            // not valid JSON, use as-is
          }
        }
      }
    } catch {
      // image is non-critical
    }

    return {
      title,
      price,
      currency,
      available,
      inStorePickup: false,
      shippingEligible,
      imageUrl,
      url,
      storeItemId,
      storeName: STORE_NAME,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  scrapeProduct,
  getBrowser,
  closeBrowser,
  STORE_NAME,
  STORE_SLUG,
};

/*
 * ── Quick verification (Node.js) ─────────────────────────────────────────────
 *
 *   $ node -e "
 *     const a = require('./amazon');
 *     a.scrapeProduct('B00EPWC30O')
 *       .then(r => console.log(JSON.stringify(r, null, 2)))
 *       .catch(e => console.error(e))
 *       .finally(() => a.closeBrowser());
 *   "
 *
 * Expected: Sony E 50mm F1.8 OSS Portrait Lens ($448.00, available, USD)
 */
