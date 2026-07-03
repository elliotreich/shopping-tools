-- Shopping Compass — Database Schema
-- SQLite 3

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- STORES
-- ============================================================
CREATE TABLE IF NOT EXISTS stores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  has_scraper   INTEGER DEFAULT 1,
  scraper_module TEXT,
  base_url      TEXT,
  active        INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- PRODUCTS
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  brand       TEXT,
  upc         TEXT,
  image_url   TEXT,
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- PRODUCT LISTINGS (one product can be listed on many stores)
-- ============================================================
CREATE TABLE IF NOT EXISTS product_listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  store_id      INTEGER NOT NULL REFERENCES stores(id),
  store_item_id TEXT,              -- ASIN, Walmart ID, Target DPCI, etc
  url           TEXT,              -- direct product URL
  title         TEXT,              -- store-specific title (may differ)
  created_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(product_id, store_id)
);

-- ============================================================
-- PRICE SNAPSHOTS (time-series pricing)
-- ============================================================
CREATE TABLE IF NOT EXISTS price_snapshots (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_listing_id  INTEGER NOT NULL REFERENCES product_listings(id),
  price               REAL,
  currency            TEXT DEFAULT 'USD',
  in_store_pickup     INTEGER DEFAULT 0,
  shipping_eligible   INTEGER DEFAULT 1,
  available           INTEGER DEFAULT 1,
  fetched_at          TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- USER LISTS
-- ============================================================
CREATE TABLE IF NOT EXISTS user_lists (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  source          TEXT DEFAULT 'amazon',   -- 'amazon' | 'manual' | 'url'
  amazon_list_name TEXT,                    -- original Amazon list name for import matching
  created_at      TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- USER LIST ITEMS (join table)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_list_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_list_id  INTEGER NOT NULL REFERENCES user_lists(id),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  sort_order    INTEGER DEFAULT 0,
  notes         TEXT,
  added_at      TEXT DEFAULT (datetime('now')),
  UNIQUE(user_list_id, product_id)
);

-- ============================================================
-- MATCH SUGGESTIONS (cross-store match candidates)
-- ============================================================
CREATE TABLE IF NOT EXISTS match_suggestions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  store_id      INTEGER NOT NULL REFERENCES stores(id),
  source_url    TEXT,
  source_title  TEXT NOT NULL,
  confidence    REAL DEFAULT 0,        -- 0.0 to 1.0
  status        TEXT DEFAULT 'pending', -- 'pending' | 'confirmed' | 'rejected'
  matched_at    TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_product_listings_product  ON product_listings(product_id);
CREATE INDEX IF NOT EXISTS idx_product_listings_store    ON product_listings(store_id);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_listing   ON price_snapshots(product_listing_id);
CREATE INDEX IF NOT EXISTS idx_price_snapshots_fetched   ON price_snapshots(fetched_at);
CREATE INDEX IF NOT EXISTS idx_user_list_items_list      ON user_list_items(user_list_id);
CREATE INDEX IF NOT EXISTS idx_user_list_items_product   ON user_list_items(product_id);
CREATE INDEX IF NOT EXISTS idx_match_suggestions_product ON match_suggestions(product_id);
CREATE INDEX IF NOT EXISTS idx_match_suggestions_status  ON match_suggestions(status);

-- ============================================================
-- SEED DATA — STORES
-- ============================================================
INSERT OR IGNORE INTO stores (id, name, slug, has_scraper, scraper_module, base_url, active) VALUES
  (1, 'Amazon',    'amazon',    1, 'amazon',    'https://www.amazon.com',    1),
  (2, 'Walmart',   'walmart',   1, 'walmart',   'https://www.walmart.com',   1),
  (3, 'Target',    'target',    1, 'target',    'https://www.target.com',    1),
  (4, 'CVS',       'cvs',       1, 'cvs',       'https://www.cvs.com',       1),
  (5, 'Walgreens', 'walgreens', 1, 'walgreens', 'https://www.walgreens.com', 1);
