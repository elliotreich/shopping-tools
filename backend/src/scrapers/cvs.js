'use strict';

const { chromium } = require('playwright');

const STORE_NAME = 'CVS';
const STORE_SLUG = 'cvs';

let _browser = null;

async function getBrowser() {
  if (!_browser) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    try {
      await _browser.close();
    } catch {
      // ignore close errors
    }
    _browser = null;
  }
}

/**
 * Extracts text content from a page element, or returns null.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @returns {Promise<string|null>}
 */
async function getText(page, selector) {
  try {
    const el = await page.locator(selector).first().waitFor({ state: 'attached', timeout: 3000 });
    return (await el.textContent())?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * CVS uses mostly server-side rendering.
 * Price is typically in .price-pdp or a span with price-related classes.
 * Title is in an h1 with title-related classes or data-testid.
 * Availability is determined by the presence of an "Add to Cart" button vs
 * an "Out of Stock" indicator.
 * Pickup / shipping info is read from the delivery options section.
 *
 * @param {string} url
 * @returns {Promise<import('./types').ScrapeResult>}
 */
async function scrapeProduct(url) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Default result — all fields null/false until proven otherwise
  const result = {
    title: null,
    price: null,
    currency: 'USD',
    available: false,
    inStorePickup: false,
    shippingEligible: false,
    imageUrl: null,
    url,
    storeItemId: null,
    storeName: STORE_NAME,
  };

  try {
    // Navigate with a generous timeout; CVS sometimes loads slowly
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });

    // Give dynamic content a moment to render
    await page.waitForTimeout(1500);

    // ---- Title ----
    const title =
      (await getText(page, 'h1[class*="title"]')) ??
      (await getText(page, '[data-testid="product-title"]')) ??
      (await getText(page, 'h1.product-title')) ??
      (await getText(page, 'h1'));
    result.title = title;

    // ---- Price ----
    // Try several selectors CVS uses, from most specific to most generic
    let priceText =
      (await getText(page, '.price-pdp')) ??
      (await getText(page, 'span[class*="price"]')) ??
      (await getText(page, '[data-testid="price"]')) ??
      (await getText(page, '.pdp-price')) ??
      (await getText(page, '.price')) ??
      (await getText(page, '[class*="PDPPrice"]'));

    if (priceText) {
      // Strip non-numeric characters except '.' and leading '-'
      const cleaned = priceText.replace(/[^0-9.]/g, '');
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed) && parsed > 0) {
        result.price = parsed;
      }
    }

    // ---- Image ----
    try {
      const imgEl = await page
        .locator(
          'img[class*="product-image"], img[class*="hero-image"], img[data-testid*="product-image"], img[alt*="product"]',
        )
        .first()
        .waitFor({ state: 'attached', timeout: 2000 });
      const src = await imgEl.getAttribute('src');
      if (src) {
        // Resolve relative URLs
        result.imageUrl = src.startsWith('http') ? src : new URL(src, url).href;
      }
    } catch {
      // image is optional
    }

    // ---- Store Item ID ----
    // CVS often embeds SKU in the page URL, meta tags, or data attributes
    try {
      // Try data-sku or data-product-id on the main container
      const mainEl = await page
        .locator('[data-sku], [data-product-id], [data-item-id]')
        .first()
        .waitFor({ state: 'attached', timeout: 2000 });
      result.storeItemId =
        (await mainEl.getAttribute('data-sku')) ??
        (await mainEl.getAttribute('data-product-id')) ??
        (await mainEl.getAttribute('data-item-id'));
    } catch {
      // fallback: extract from URL path
      const match = url.match(/\/shop\/[^/]+\/([^/?]+)/);
      if (match) {
        result.storeItemId = match[1];
      }
    }

    // ---- Availability ----
    // Check if "Add to Cart" button is present and enabled,
    // and "Out of Stock" / "Sold Out" is NOT present.
    const pageText = await page.locator('body').innerText().catch(() => '');
    const lowerText = pageText.toLowerCase();

    const hasOutOfStock =
      lowerText.includes('out of stock') ||
      lowerText.includes('sold out') ||
      lowerText.includes('temporarily unavailable') ||
      lowerText.includes('currently unavailable');

    const hasAddToCart =
      (await page
        .locator(
          'button:has-text("Add to Cart"), button:has-text("Add to cart"), [data-testid="add-to-cart"], button[class*="add-to-cart"], button[class*="addToCart"]',
        )
        .first()
        .isVisible()
        .catch(() => false)) ||
      (await page
        .locator(
          'button:has-text("Add to Cart"), button:has-text("Add to cart"), [data-testid="add-to-cart"], button[class*="add-to-cart"], button[class*="addToCart"]',
        )
        .first()
        .isEnabled()
        .catch(() => false));

    if (hasOutOfStock) {
      result.available = false;
    } else if (hasAddToCart) {
      result.available = true;
    } else {
      // If we can't determine, assume available if price is present
      result.available = result.price !== null;
    }

    // ---- Delivery options ----
    // CVS shows pickup / shipping options in a delivery section.
    // Look for common indicators.
    if (
      lowerText.includes('pick up') ||
      lowerText.includes('store pickup') ||
      lowerText.includes('in-store pickup') ||
      lowerText.includes('same day pickup')
    ) {
      result.inStorePickup = true;
    }

    if (
      lowerText.includes('shipping') ||
      lowerText.includes('delivery') ||
      lowerText.includes('ship it') ||
      lowerText.includes('free shipping')
    ) {
      result.shippingEligible = true;
    }

    return result;
  } catch (err) {
    // Return best-effort result on any error
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { scrapeProduct, closeBrowser, STORE_NAME, STORE_SLUG };
