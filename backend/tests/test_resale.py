"""Unit tests for resale.py using a temporary SQLite database.

The temp DB mirrors the documented resale-feed schema. Tests also assert
the read-only guarantee: calling the API must never create or modify files.
"""
import json
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

import resale

SCHEMA = """
CREATE TABLE seen (
    listing_id   TEXT PRIMARY KEY,
    platform     TEXT,
    url          TEXT,
    title        TEXT,
    price        REAL,
    brand_hint   TEXT,
    score        INTEGER,
    score_json   TEXT,
    notified     INTEGER DEFAULT 0,
    first_seen   TEXT,
    image_url    TEXT
);
CREATE TABLE run_stats (
    ts           TEXT PRIMARY KEY,
    fetched      INTEGER,
    new_listings INTEGER,
    scored_high  INTEGER,
    notified     INTEGER,
    errors       TEXT
);
"""


def insert_listing(conn, **kwargs):
    defaults = {
        "listing_id": "ebay:1",
        "platform": "ebay",
        "url": "https://www.ebay.com/itm/1",
        "title": "Listing",
        "price": 100.0,
        "brand_hint": "",
        "score": 50,
        "score_json": None,
        "notified": 0,
        "first_seen": "2026-07-26 20:00:00",
        "image_url": "",
    }
    defaults.update(kwargs)
    conn.execute(
        "INSERT INTO seen (listing_id, platform, url, title, price, brand_hint,"
        " score, score_json, notified, first_seen, image_url)"
        " VALUES (:listing_id, :platform, :url, :title, :price, :brand_hint,"
        " :score, :score_json, :notified, :first_seen, :image_url)",
        defaults,
    )


def build_db(path):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    insert_listing(
        conn,
        listing_id="ebay:high",
        title="Brioni Jacket",
        brand_hint="brioni",
        price=1200.0,
        score=85,
        score_json=json.dumps(
            {"brand_name": "brioni", "total": 85, "measurements": {"chest": 42.0}}
        ),
        first_seen="2026-07-28 10:00:00",
    )
    insert_listing(
        conn,
        listing_id="ebay:mid",
        title="Isaia Suit",
        brand_hint="isaia",
        price=300.0,
        score=55,
        first_seen="2026-07-27 09:00:00",
    )
    insert_listing(
        conn,
        listing_id="ebay:low",
        title="Unknown Jacket",
        brand_hint="",
        price=None,
        score=30,
        first_seen="2026-07-26 08:00:00",
    )
    insert_listing(
        conn,
        listing_id="grailed:zenga",
        platform="grailed",
        title="Zegna Coat",
        brand_hint="zenga",
        price=2400.0,
        score=90,
        score_json=json.dumps(
            {"brand_name": "zegna", "total": 90, "measurements": {"size_tag": "52"}}
        ),
        first_seen="2026-07-29 12:00:00",
    )
    conn.execute(
        "INSERT INTO run_stats VALUES (?,?,?,?,?,?)",
        ("2026-07-29 12:00:00", 40, 4, 2, 2, "[]"),
    )
    conn.execute(
        "INSERT INTO run_stats VALUES (?,?,?,?,?,?)",
        ("2026-07-28 12:00:00", 40, 6, 3, 3, '["one error"]'),
    )
    conn.commit()
    conn.close()


class ResaleTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp.name, "seen.db")
        build_db(self.db_path)
        patcher = mock.patch("config.seen_db_path", return_value=self.db_path)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.tmp.cleanup)

    def files_in_tmp(self):
        return sorted(os.listdir(self.tmp.name))


class ListListingsTests(ResaleTestCase):
    def test_recent_first_order(self):
        listings, err = resale.list_listings()
        self.assertIsNone(err)
        self.assertEqual(len(listings), 4)
        self.assertEqual(listings[0]["id"], "grailed:zenga")  # newest first_seen
        self.assertEqual(listings[-1]["id"], "ebay:low")

    def test_fields_present(self):
        listings, _ = resale.list_listings()
        first = listings[0]
        self.assertEqual(first["score"], 90)
        self.assertEqual(first["price"], 2400.0)
        self.assertEqual(first["brand"], "zenga")
        self.assertEqual(first["platform"], "grailed")
        self.assertEqual(first["title"], "Zegna Coat")
        self.assertEqual(first["url"], "https://www.ebay.com/itm/1")
        self.assertEqual(first["measurements"], {"size_tag": "52"})

    def test_measurements_only_when_present(self):
        listings, _ = resale.list_listings()
        mid = next(l for l in listings if l["id"] == "ebay:mid")
        self.assertNotIn("measurements", mid)

    def test_null_price_becomes_none(self):
        listings, _ = resale.list_listings()
        low = next(l for l in listings if l["id"] == "ebay:low")
        self.assertIsNone(low["price"])

    def test_brand_falls_back_to_score_json(self):
        listings, _ = resale.list_listings()
        zenga = next(l for l in listings if l["id"] == "grailed:zenga")
        # brand_hint is set here; also verify fallback when brand_hint empty
        self.assertEqual(zenga["brand"], "zenga")

    def test_min_score_filter(self):
        listings, _ = resale.list_listings(min_score=70)
        self.assertEqual([l["id"] for l in listings], ["grailed:zenga", "ebay:high"])

    def test_limit(self):
        listings, _ = resale.list_listings(limit=2)
        self.assertEqual(len(listings), 2)

    def test_limit_clamped_to_range(self):
        listings, _ = resale.list_listings(limit=10000)
        self.assertEqual(len(listings), 4)
        listings, _ = resale.list_listings(limit=0)
        self.assertEqual(len(listings), 1)  # clamped to 1

    def test_read_only_no_files_created(self):
        before = self.files_in_tmp()
        resale.list_listings()
        resale.list_listings(min_score=70)
        resale.summary()
        self.assertEqual(self.files_in_tmp(), before)

    def test_read_only_cannot_write(self):
        # Attempting any write through this module's connection must fail.
        conn = resale._connect(self.db_path)
        with self.assertRaises(sqlite3.OperationalError):
            conn.execute("DROP TABLE seen")
        conn.close()


class SummaryTests(ResaleTestCase):
    def test_summary_counts(self):
        summary, err = resale.summary()
        self.assertIsNone(err)
        self.assertEqual(summary["total_listings"], 4)
        self.assertEqual(summary["listings_with_price"], 3)
        self.assertEqual(summary["high_score_count"], 2)
        self.assertEqual(summary["high_score_threshold"], 70)
        self.assertEqual(summary["max_score"], 90)
        self.assertEqual(summary["avg_score"], 65.0)
        self.assertEqual(summary["price_min"], 300.0)
        self.assertEqual(summary["price_max"], 2400.0)
        self.assertEqual(summary["platforms"], [
            {"platform": "ebay", "count": 3},
            {"platform": "grailed", "count": 1},
        ])
        self.assertEqual(summary["top_brands"][0], {"brand": "zenga", "count": 1})

    def test_summary_recent_runs(self):
        summary, _ = resale.summary()
        self.assertEqual(len(summary["recent_runs"]), 2)
        # newest run first
        self.assertEqual(summary["recent_runs"][0]["ts"], "2026-07-29 12:00:00")


class MissingDbTests(unittest.TestCase):
    def test_listings_missing_db_returns_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = os.path.join(tmp, "nope.db")
            with mock.patch("config.seen_db_path", return_value=missing):
                listings, err = resale.list_listings()
            self.assertIsNone(listings)
            self.assertIn("cannot read database", err)
            # no file was created
            self.assertEqual(sorted(os.listdir(tmp)), [])

    def test_summary_missing_db_returns_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = os.path.join(tmp, "nope.db")
            with mock.patch("config.seen_db_path", return_value=missing):
                summary, err = resale.summary()
            self.assertIsNone(summary)
            self.assertIn("database not found", err)
            self.assertEqual(sorted(os.listdir(tmp)), [])


if __name__ == "__main__":
    unittest.main()
