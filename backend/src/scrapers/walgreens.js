'use strict';

const { chromium } = require('playwright');

const STORE_NAME = 'Walgreens';
const STORE_SLUG = 'walgreens';

// Default ZIP code for store pickup / same-day delivery checks
const DEFAULT_ZIP = '11375';

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
 * Dismisses the ZIP code prompt if it appears.
 * Walgreens often shows a "Set your store" or ZIP code modal on first visit.
 * We enter a default ZIP and submit it.
 *
 * @param {import('playwright').Page} page
 */
async function dismissZipPrompt(page) {
  try {
    // The prompt might be a modal overlay or an inline bar.
    // Try several patterns Walgreens uses.
    const zipInput =
      (await page.locator('input[placeholder*="ZIP"], input[placeholder*="zip"], input[aria-label*="ZIP"], input[name*="zip"], input[id*="zip"]').first().waitFor({ state: 'attached', timeout: 2000 }).catch(() => null));

    if (zipInput) {
      await zipInput.fill(DEFAULT_ZIP);

      // Click the submit / set button that accompanies the input
      const submitBtn =
        (await page.locator('button:has-text("Set"), button:has-text("Apply"), button:has-text("Submit"), button:has-text("Continue")').first().waitFor({ state: 'attached', timeout: 2000 }).catch(() => null));

      if (submitBtn) {
        await submitBtn.click();
        // Wait for the modal to dismiss
        await page.waitForTimeout(1000);
      }
    }
  } catch {
    // No ZIP prompt — that's fine
  }
}

/**
 * Walgreens uses aggressive React rendering.
 * Price lives in .price__amount, [data-testid="price"], or span.price.
 * Title lives in h1[class*="title"] or [data-testid="product-name"].
 * The page frequently spawns a ZIP code prompt on first load.
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
    // Navigate
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });

    // Give React hydration and re-renders time to settle
    await page.waitForTimeout(2000);

    // ---- Dismiss ZIP prompt ----
    await dismissZipPrompt(page);

    // Wait a bit more after interaction
    await page.waitForTimeout(1000);

    // ---- Title ----
    const title =
      (await getText(page, 'h1[class*="title"]')) ??
      (await getText(page, '[data-testid="product-name"]')) ??
      (await getText(page, 'h1.product-title')) ??
      (await getText(page, '[class*="productName"]')) ??
      (await getText(page, 'h1'));
    result.title = title;

    // ---- Price ----
    let priceText =
      (await getText(page, '.price__amount')) ??
      (await getText(page, '[data-testid="price"]')) ??
      (await getText(page, 'span.price')) ??
      (await getText(page, '[class*="price"]')) ??
      (await getText(page, '.product-price')) ??
      (await getText(page, '[data-testid="product-price"]'));

    if (priceText) {
      // Walgreens sometimes shows "Starting at $X.XX" or "Now $X.XX"
      // Try to grab the dollar amount
      const match = priceText.match(/\$?(\d+\.\d{2})/);
      const cleaned = match ? match[1] : priceText.replace(/[^0-9.]/g, '');
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed) && parsed > 0) {
        result.price = parsed;
      }
    }

    // ---- Image ----
    try {
      const imgEl = await page
        .locator(
          'img[class*="product-image"], img[class*="hero"], img[data-testid*="product-image"], img[alt*="product"], img[class*="ProductImage"]',
        )
        .first()
        .waitFor({ state: 'attached', timeout: 2000 });
      const src = await imgEl.getAttribute('src');
      if (src) {
        result.imageUrl = src.startsWith('http') ? src : new URL(src, url).href;
      }
    } catch {
      // image is optional
    }

    // ---- Store Item ID ----
    // Walgreens often uses data attributes or a WIC/SKU in the page
    try {
      const idEl = await page
        .locator('[data-sku], [data-product-sku], [data-item-id], [data-wic]')
        .first()
        .waitFor({ state: 'attached', timeout: 2000 });
      result.storeItemId =
        (await idEl.getAttribute('data-sku')) ??
        (await idEl.getAttribute('data-product-sku')) ??
        (await idEl.getAttribute('data-item-id')) ??
        (await idEl.getAttribute('data-wic'));
    } catch {
      // Fallback: extract from URL
      const match = url.match(/\/product\/([^/?]+)/);
      if (match) {
        result.storeItemId = match[1];
      }
    }

    // ---- Availability ----
    const pageText = await page.locator('body').innerText().catch(() => '');
    const lowerText = pageText.toLowerCase();

    const hasOutOfStock =
      lowerText.includes('out of stock') ||
      lowerText.includes('sold out') ||
      lowerText.includes('temporarily unavailable') ||
      lowerText.includes('currently unavailable') ||
      lowerText.includes('not available');

    const hasAddToCart =
      (await page
        .locator(
          'button:has-text("Add to Cart"), button:has-text("Add to cart"), [data-testid="add-to-cart"], button[class*="add-to-cart"], button[aria-label*="Add to Cart"]',
        )
        .first()
        .isVisible()
        .catch(() => false)) ||
      (await page
        .locator(
          'button:has-text("Add to Cart"), button:has-text("Add to cart"), [data-testid="add-to-cart"], button[class*="add-to-cart"], button[aria-label*="Add to Cart"]',
        )
        .first()
        .isEnabled()
        .catch(() => false));

    if (hasOutOfStock) {
      result.available = false;
    } else if (hasAddToCart) {
      result.available = true;
    } else {
      result.available = result.price !== null;
    }

    // ---- Delivery options ----
    if (
      lowerText.includes('same day pickup') ||
      lowerText.includes('free store pickup') ||
      lowerText.includes('store pickup') ||
      lowerText.includes('pickup today') ||
      lowerText.includes('pick up')
    ) {
      result.inStorePickup = true;
    }

    if (
      lowerText.includes('shipping') ||
      lowerText.includes('delivery') ||
      lowerText.includes('ship it') ||
      lowerText.includes('free shipping') ||
      lowerText.includes('same day delivery')
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
