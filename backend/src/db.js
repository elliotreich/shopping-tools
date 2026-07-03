"use strict";

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = path.resolve(__dirname, "..", "data", "shopping-compass.db");
const SCHEMA_PATH = path.resolve(__dirname, "schema.sql");

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let _db = null;

/**
 * Return the singleton better-sqlite3 Database instance.
 * Opens the database on first call.
 */
function getDb() {
  if (_db) return _db;

  // Ensure data dir exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  _db = new Database(DB_PATH);

  // Enable WAL mode and foreign keys on every connection
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  return _db;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Read schema.sql and execute every statement.
 * Comments and blank lines are stripped first; the remaining SQL is passed to
 * better-sqlite3's exec() which handles multi-statement strings natively.
 *
 * Returns the count of non-empty SQL statements executed.
 */
function init() {
  let sql = fs.readFileSync(SCHEMA_PATH, "utf-8");

  // Strip SQL comments (lines starting with --)
  sql = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  const db = getDb();
  db.exec(sql);

  // Count non-empty statements for the return value
  const count = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;

  return count;
}

// ---------------------------------------------------------------------------
// Helper query functions
// ---------------------------------------------------------------------------

/**
 * Return all products belonging to a list, joined with user_list_items.
 * Each row: product fields + sort_order + notes + added_at.
 */
function getProductsByList(listId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT p.*, uli.sort_order, uli.notes AS list_notes, uli.added_at
       FROM products p
       JOIN user_list_items uli ON uli.product_id = p.id
       WHERE uli.user_list_id = ?
       ORDER BY uli.sort_order ASC, uli.added_at DESC`
    )
    .all(listId);
}

/**
 * Return full detail for a single product:
 *   - product row
 *   - listings: array of product_listings with store info + latest price
 *
 * Returns { product, listings }.
 */
function getProductDetail(productId) {
  const db = getDb();

  const product = db
    .prepare(
      `SELECT * FROM products WHERE id = ?`
    )
    .get(productId);

  if (!product) return null;

  const listings = db
    .prepare(
      `SELECT pl.*,
              s.name      AS store_name,
              s.slug      AS store_slug,
              ps.price    AS latest_price,
              ps.fetched_at AS price_fetched_at,
              ps.currency,
              ps.in_store_pickup,
              ps.shipping_eligible,
              ps.available
       FROM product_listings pl
       JOIN stores s ON s.id = pl.store_id
       LEFT JOIN (
         SELECT product_listing_id, price, fetched_at, currency,
                in_store_pickup, shipping_eligible, available
         FROM price_snapshots
         WHERE id IN (
           SELECT MAX(id) FROM price_snapshots GROUP BY product_listing_id
         )
       ) ps ON ps.product_listing_id = pl.id
       WHERE pl.product_id = ?
       ORDER BY s.name`
    )
    .all(productId);

  return { product, listings };
}

/**
 * Return all price snapshots for a product (across all listings), joined with
 * store information. Ordered newest-first.
 */
function getPricesForProduct(productId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT ps.*,
              pl.store_item_id,
              pl.url        AS listing_url,
              pl.title      AS listing_title,
              s.name        AS store_name,
              s.slug        AS store_slug
       FROM price_snapshots ps
       JOIN product_listings pl ON pl.id = ps.product_listing_id
       JOIN stores s ON s.id = pl.store_id
       WHERE pl.product_id = ?
       ORDER BY ps.fetched_at DESC`
    )
    .all(productId);
}

/**
 * Insert a new product and return its id.
 *
 * @param {object} data  — { title, description?, brand?, upc?, image_url?, notes? }
 * @returns {number}
 */
function createProduct(data) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO products (title, description, brand, upc, image_url, notes)
     VALUES (@title, @description, @brand, @upc, @image_url, @notes)`
  );

  const result = stmt.run({
    title: data.title,
    description: data.description ?? null,
    brand: data.brand ?? null,
    upc: data.upc ?? null,
    image_url: data.image_url ?? null,
    notes: data.notes ?? null,
  });

  return Number(result.lastInsertRowid);
}

/**
 * Upsert a product_listing row. If a listing already exists for the given
 * (product_id, store_id) pair the row is updated with the new values.
 *
 * @param {number} productId
 * @param {number} storeId
 * @param {object} data  — { store_item_id?, url?, title? }
 * @returns {number} id of the listing row.
 */
function createProductListing(productId, storeId, data) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO product_listings (product_id, store_id, store_item_id, url, title)
     VALUES (@product_id, @store_id, @store_item_id, @url, @title)
     ON CONFLICT(product_id, store_id) DO UPDATE SET
       store_item_id = COALESCE(excluded.store_item_id, product_listings.store_item_id),
       url           = COALESCE(excluded.url,           product_listings.url),
       title         = COALESCE(excluded.title,         product_listings.title)`
  );

  const result = stmt.run({
    product_id: productId,
    store_id: storeId,
    store_item_id: data.store_item_id ?? null,
    url: data.url ?? null,
    title: data.title ?? null,
  });

  return Number(result.lastInsertRowid);
}

/**
 * Insert a new price snapshot for a listing.
 *
 * @param {number} listingId
 * @param {object} data  — { price, currency?, in_store_pickup?, shipping_eligible?, available? }
 * @returns {number} id of the snapshot row.
 */
function insertPriceSnapshot(listingId, data) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO price_snapshots
       (product_listing_id, price, currency, in_store_pickup, shipping_eligible, available)
     VALUES
       (@product_listing_id, @price, @currency, @in_store_pickup, @shipping_eligible, @available)`
  );

  const result = stmt.run({
    product_listing_id: listingId,
    price: data.price ?? null,
    currency: data.currency ?? "USD",
    in_store_pickup: data.in_store_pickup ? 1 : 0,
    shipping_eligible: data.shipping_eligible !== undefined ? (data.shipping_eligible ? 1 : 0) : 1,
    available: data.available !== undefined ? (data.available ? 1 : 0) : 1,
  });

  return Number(result.lastInsertRowid);
}

/**
 * Return all active stores.
 */
function getStores() {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM stores WHERE active = 1 ORDER BY name ASC`
    )
    .all();
}

/**
 * Return all user lists, newest first.
 */
function getUserLists() {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM user_lists ORDER BY created_at DESC`
    )
    .all();
}

/**
 * Create a new user list and return its id.
 *
 * @param {object} data  — { name, source?, amazon_list_name? }
 * @returns {number}
 */
function createUserList(data) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO user_lists (name, source, amazon_list_name)
     VALUES (@name, @source, @amazon_list_name)`
  );

  const result = stmt.run({
    name: data.name,
    source: data.source ?? "manual",
    amazon_list_name: data.amazon_list_name ?? null,
  });

  return Number(result.lastInsertRowid);
}

/**
 * Add a product to a list. If the pair already exists the sort_order and notes
 * are updated.
 *
 * @param {number} listId
 * @param {number} productId
 * @param {number} [sortOrder=0]
 * @returns {number} id of the user_list_items row.
 */
function addItemToList(listId, productId, sortOrder) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO user_list_items (user_list_id, product_id, sort_order)
     VALUES (@user_list_id, @product_id, @sort_order)
     ON CONFLICT(user_list_id, product_id) DO UPDATE SET
       sort_order = excluded.sort_order`
  );

  const result = stmt.run({
    user_list_id: listId,
    product_id: productId,
    sort_order: sortOrder ?? 0,
  });

  return Number(result.lastInsertRowid);
}

/**
 * Return pending match suggestions for a product.
 */
function getMatchSuggestions(productId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT ms.*, s.name AS store_name, s.slug AS store_slug
       FROM match_suggestions ms
       JOIN stores s ON s.id = ms.store_id
       WHERE ms.product_id = ?
       ORDER BY ms.confidence DESC`
    )
    .all(productId);
}

/**
 * Update the status of a match suggestion (confirm or reject).
 *
 * @param {number} id   — match_suggestions row id
 * @param {string} status — 'confirmed' | 'rejected'
 */
function updateMatchStatus(id, status) {
  const db = getDb();
  db.prepare(`UPDATE match_suggestions SET status = ? WHERE id = ?`).run(
    status,
    id
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  getDb,
  init,
  getProductsByList,
  getProductDetail,
  getPricesForProduct,
  createProduct,
  createProductListing,
  insertPriceSnapshot,
  getStores,
  getUserLists,
  createUserList,
  addItemToList,
  getMatchSuggestions,
  updateMatchStatus,
};
