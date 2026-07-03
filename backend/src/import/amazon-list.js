"use strict";

const path = require("path");
const fs = require("fs");
const db = require("../db");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_RAW_DIR = "/Users/elliot.reich/amazon-lists-export/raw/";
const AMAZON_STORE_ID = 1;

/**
 * Map from filename stems (without .json) to user_list display names.
 */
const LIST_MAP = {
  ELLIOT: "#ELLIOT",
  Watches: "Watches",
  Shopping_List: "Shopping List",
  Jewels: "Jewels",
  Clothes: "Clothes",
  Ski_Capsule: "Ski Capsule",
  Coffee: "Coffee",
  Hosting_gifts: "Hosting gifts",
  Choices: "Choices",
  HOMELAB: "HOMELAB",
};

/**
 * Filename stems to skip entirely.
 */
const SKIP_FILES = ["Alexa_List_grocery", "Save_for_Later"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a price value from an Amazon export row.
 *
 * Accepts:
 *   - null / undefined  → null
 *   - "$19.95"          → 19.95
 *   - "19.95"           → 19.95
 *   - 19.95             → 19.95
 *
 * @param {*} raw
 * @returns {number|null}
 */
function parsePrice(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
  const val = parseFloat(cleaned);
  return Number.isFinite(val) ? val : null;
}

/**
 * Find or create a user list by display name.
 *
 * @param {string} name       - Display name (e.g. "#ELLIOT")
 * @param {string} [amazonName] - Original Amazon list name (filename stem)
 * @returns {number} list id
 */
function ensureList(name, amazonName) {
  const _db = db.getDb();

  let row = _db
    .prepare("SELECT id FROM user_lists WHERE name = ?")
    .get(name);

  if (!row) {
    const id = db.createUserList({
      name,
      source: "amazon",
      amazon_list_name: amazonName ?? name,
    });
    return id;
  }

  return row.id;
}

/**
 * Look up a product by its Amazon ASIN.
 *
 * @param {string} asin
 * @returns {object|null} product row or null
 */
function findProductByAsin(asin) {
  const _db = db.getDb();
  return _db
    .prepare(
      `SELECT p.*
       FROM products p
       JOIN product_listings pl ON pl.product_id = p.id
       WHERE pl.store_item_id = ? AND pl.store_id = ?`
    )
    .get(asin, AMAZON_STORE_ID);
}

/**
 * Import a single item into the database.
 *
 * Steps:
 *   1. Check if product exists by ASIN → reuse if found
 *   2. Otherwise create product + listing rows
 *   3. Insert price snapshot if a price is present
 *   4. Link product to the target user list
 *
 * All mutations happen inside the caller's transaction.
 *
 * @param {object}   item       - { title, asin, price }
 * @param {number}   listId     - user_list id
 * @param {number}   sortOrder  - position within the list
 */
function importItem(item, listId, sortOrder) {
  if (!item.asin) {
    console.warn(
      `  ⚠ Skipping item with no ASIN: ${item.title || "(no title)"}`
    );
    return;
  }

  const existing = findProductByAsin(item.asin);

  let productId;
  if (existing) {
    productId = existing.id;
  } else {
    // -- Create product ------------------------------------------------
    productId = db.createProduct({
      title: item.title,
    });

    // -- Create Amazon listing -----------------------------------------
    db.createProductListing(productId, AMAZON_STORE_ID, {
      store_item_id: item.asin,
      url: `https://www.amazon.com/dp/${item.asin}`,
      title: item.title,
    });
  }

  // -- Price snapshot --------------------------------------------------
  const price = parsePrice(item.price);
  if (price != null) {
    const _db = db.getDb();
    const listing = _db
      .prepare(
        "SELECT id FROM product_listings WHERE product_id = ? AND store_id = ?"
      )
      .get(productId, AMAZON_STORE_ID);

    if (listing) {
      db.insertPriceSnapshot(listing.id, { price });
    }
  }

  // -- Link to list ----------------------------------------------------
  db.addItemToList(listId, productId, sortOrder);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Import a single Amazon list JSON file.
 *
 * @param {string} filePath  - Absolute path to the JSON file
 * @param {string} listName  - Display name for the user list
 * @returns {Promise<number>} Number of items imported
 */
async function importList(filePath, listName) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const items = JSON.parse(raw);

  if (!Array.isArray(items) || items.length === 0) {
    console.log(`  ℹ  No items in ${path.basename(filePath)} — nothing to do.`);
    return 0;
  }

  console.log(
    `  → Importing ${items.length} items into list "${listName}"...`
  );

  const _db = db.getDb();
  const listId = ensureList(listName, path.basename(filePath, ".json"));

  const tx = _db.transaction(() => {
    for (let i = 0; i < items.length; i++) {
      importItem(items[i], listId, i);
    }
  });

  tx();

  console.log(`  ✓  ${items.length} items in "${listName}"`);
  return items.length;
}

/**
 * Import all Amazon list exports from a directory.
 *
 * Reads every `.json` file in `rawDir`, maps it to a user list via
 * LIST_MAP, skips files in SKIP_FILES, and imports every item.
 *
 * @param {string} [rawDir]  - Path to directory containing JSON files
 * @returns {Promise<{ listsImported: number, itemsImported: number }>}
 */
async function importAll(rawDir) {
  const dir = rawDir || DEFAULT_RAW_DIR;

  if (!fs.existsSync(dir)) {
    throw new Error(`Raw data directory not found: ${dir}`);
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

  let listsImported = 0;
  let itemsImported = 0;

  for (const file of files.sort()) {
    const stem = path.basename(file, ".json");

    if (SKIP_FILES.includes(stem)) {
      console.log(`  - Skipping ${file} (excluded)`);
      continue;
    }

    const listName = LIST_MAP[stem];
    if (!listName) {
      console.warn(`  ⚠ No mapping for ${file} — skipping`);
      continue;
    }

    const filePath = path.resolve(dir, file);
    const count = await importList(filePath, listName);
    listsImported++;
    itemsImported += count;
  }

  return { listsImported, itemsImported };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { importAll, importList, LIST_MAP, SKIP_FILES };
