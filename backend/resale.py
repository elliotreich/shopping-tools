"""Read-only access to a resale-feed SQLite store.

The database is opened with SQLite's `mode=ro` URI flag plus `PRAGMA
query_only = 1`, so this module can never create, alter, or write to the
resale-feed data. A missing file is an error, never a newly created
database.

Measurements live inside the `score_json` TEXT column as JSON
({"measurements": {...}}); they are surfaced only when present.
"""
import json
import os
import sqlite3

import config

# Score at or above which a listing counts as "high".
# Watcher's NOTIFY_THRESHOLD so the summary aligns with what it reports).
HIGH_SCORE_THRESHOLD = 70

_QUERY_COLUMNS = (
    "listing_id, platform, url, title, price, brand_hint, score, "
    "score_json, first_seen, image_url"
)


def _connect(db_path: str):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    # Belt-and-braces: read-only URI plus an explicit query-only pragma.
    conn.execute("PRAGMA query_only = 1")
    return conn


def _extract_measurements(score_json):
    """Return the measurements dict from score_json, or None if absent."""
    if not score_json:
        return None
    try:
        data = json.loads(score_json)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    measurements = data.get("measurements")
    if isinstance(measurements, dict) and measurements:
        return measurements
    return None


def _extract_brand_name(score_json):
    """Fallback brand from score_json.brand_name when brand_hint is empty."""
    if not score_json:
        return None
    try:
        data = json.loads(score_json)
    except (TypeError, ValueError):
        return None
    if isinstance(data, dict) and data.get("brand_name"):
        return data["brand_name"]
    return None


def _row_to_listing(row) -> dict:
    price = row["price"]
    listing = {
        "id": row["listing_id"],
        "platform": row["platform"],
        "url": row["url"],
        "title": row["title"],
        "price": price if price not in (None, "") else None,
        "brand": row["brand_hint"] or _extract_brand_name(row["score_json"]),
        "score": row["score"],
        "first_seen": row["first_seen"],
        "image_url": row["image_url"],
    }
    measurements = _extract_measurements(row["score_json"])
    if measurements:
        listing["measurements"] = measurements
    return listing


def list_listings(limit: int = 50, min_score: float = 0, db_path=None):
    """Recent listings ordered by first_seen desc, filtered by min score.

    Returns (listings, error | None).
    """
    limit = max(1, min(int(limit), 500))
    min_score = float(min_score)
    path = db_path or config.seen_db_path()
    where, params = "", []
    if min_score > 0:
        where = "WHERE score >= ?"
        params.append(min_score)
    try:
        conn = _connect(path)
    except sqlite3.Error as exc:
        return None, f"cannot read database {path!r} read-only: {exc}"
    with conn:
        rows = conn.execute(
            f"SELECT {_QUERY_COLUMNS} FROM seen {where} "
            "ORDER BY first_seen DESC, listing_id DESC LIMIT ?",
            params + [limit],
        ).fetchall()
    return [_row_to_listing(r) for r in rows], None


def summary(db_path=None):
    """Aggregate stats across the seen and run_stats tables.

    Returns (dict | None, error | None).
    """
    path = db_path or config.seen_db_path()
    if not os.path.exists(path):
        return None, f"database not found: {path}"
    try:
        conn = _connect(path)
    except sqlite3.Error as exc:
        return None, f"database error: {exc}"
    with conn:
        total = conn.execute("SELECT COUNT(*) FROM seen").fetchone()[0]
        with_price = conn.execute(
            "SELECT COUNT(*) FROM seen WHERE price IS NOT NULL AND price != ''"
        ).fetchone()[0]
        avg_score = conn.execute(
            "SELECT AVG(score) FROM seen WHERE score IS NOT NULL"
        ).fetchone()[0]
        max_score = conn.execute(
            "SELECT MAX(score) FROM seen WHERE score IS NOT NULL"
        ).fetchone()[0]
        high_count = conn.execute(
            "SELECT COUNT(*) FROM seen WHERE score IS NOT NULL AND score >= ?",
            (HIGH_SCORE_THRESHOLD,),
        ).fetchone()[0]
        top_brands = [
            dict(r)
            for r in conn.execute(
                "SELECT brand_hint AS brand, COUNT(*) AS count FROM seen "
                "WHERE brand_hint IS NOT NULL AND brand_hint != '' "
                "GROUP BY brand_hint ORDER BY count DESC LIMIT 5"
            )
        ]
        platforms = [
            dict(r)
            for r in conn.execute(
                "SELECT platform, COUNT(*) AS count FROM seen "
                "GROUP BY platform ORDER BY count DESC"
            )
        ]
        price_row = conn.execute(
            "SELECT MIN(price), MAX(price), AVG(price) FROM seen "
            "WHERE price IS NOT NULL AND price != ''"
        ).fetchone()
        recent_runs = [
            dict(r)
            for r in conn.execute(
                "SELECT ts, fetched, new_listings, scored_high, notified, errors "
                "FROM run_stats ORDER BY ts DESC LIMIT 10"
            )
        ]
    return (
        {
            "total_listings": total,
            "listings_with_price": with_price,
            "high_score_count": high_count,
            "high_score_threshold": HIGH_SCORE_THRESHOLD,
            "avg_score": _round(avg_score, 1),
            "max_score": max_score,
            "price_min": price_row[0],
            "price_max": price_row[1],
            "price_avg": _round(price_row[2], 2),
            "top_brands": top_brands,
            "platforms": platforms,
            "recent_runs": recent_runs,
        },
        None,
    )


def _round(value, ndigits: int):
    if isinstance(value, (int, float)) and value == value:  # not NaN
        return round(value, ndigits)
    return None
