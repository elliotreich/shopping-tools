"""Canonical SQLite store for remote discovery searches, runs, and findings."""
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_DB_PATH = "/var/lib/shopping-tools/discovery.sqlite3"


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def db_path():
    return Path(os.environ.get("DISCOVERY_DB_PATH", DEFAULT_DB_PATH))


def connect(path=None):
    target = Path(path or db_path())
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init(path=None):
    with connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS searches (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                profile_json TEXT NOT NULL,
                source_adapters_json TEXT NOT NULL,
                schedule TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                last_run_id TEXT,
                next_run_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS findings (
                id TEXT PRIMARY KEY,
                search_id TEXT NOT NULL REFERENCES searches(id),
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                source TEXT NOT NULL,
                source_id TEXT NOT NULL,
                url TEXT NOT NULL,
                image_url TEXT,
                price REAL,
                is_free INTEGER NOT NULL DEFAULT 0,
                location TEXT,
                description TEXT,
                score REAL,
                score_reasons_json TEXT NOT NULL DEFAULT '[]',
                discovered_at TEXT,
                freshness TEXT,
                status TEXT NOT NULL DEFAULT 'new',
                company TEXT,
                role TEXT,
                salary TEXT,
                fit_score REAL,
                application_status TEXT,
                raw_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(search_id, source_id)
            );
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                search_id TEXT NOT NULL REFERENCES searches(id),
                started_at TEXT NOT NULL,
                finished_at TEXT,
                status TEXT NOT NULL,
                runtime_seconds REAL,
                fetched_count INTEGER NOT NULL DEFAULT 0,
                retained_count INTEGER NOT NULL DEFAULT 0,
                rejected_count INTEGER NOT NULL DEFAULT 0,
                notification_count INTEGER NOT NULL DEFAULT 0,
                source_errors_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS finding_actions (
                id TEXT PRIMARY KEY,
                finding_id TEXT NOT NULL REFERENCES findings(id),
                action TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS findings_search_status_idx ON findings(search_id, status, score DESC);
            CREATE INDEX IF NOT EXISTS runs_search_started_idx ON runs(search_id, started_at DESC);
            """
        )
        _seed_defaults(conn)


def _seed_defaults(conn):
    now = utc_now()
    defaults = [
        (
            "patio",
            "Patio tables under $50",
            "goods",
            {
                "keywords": ["patio table", "outdoor table", "bistro table", "garden table"],
                "budget": 50,
                "location": "NYC metro",
                "radius_miles": 40,
                "vehicle": "Honda Accord",
                "size_constraints": "fits in vehicle",
            },
            ["craigslist-indexed", "facebook-public-indexed"],
            "30 8,12,16,20 * * *",
        ),
        (
            "jobs",
            "Policy, civic, arts, and media jobs",
            "jobs",
            {
                "keywords": ["policy", "civic", "arts", "media", "public service"],
                "location": "NYC or remote",
                "radius_miles": 50,
            },
            ["job-agents-json"],
            "0 8 * * *",
        ),
    ]
    for search_id, name, kind, profile, adapters, schedule in defaults:
        conn.execute(
            """
            INSERT OR IGNORE INTO searches
            (id,name,kind,profile_json,source_adapters_json,schedule,status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (search_id, name, kind, json.dumps(profile), json.dumps(adapters), schedule, "active", now, now),
        )


def _json(value, fallback):
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _search(row):
    item = dict(row)
    item["profile"] = _json(item.pop("profile_json"), {})
    item["source_adapters"] = _json(item.pop("source_adapters_json"), [])
    return item


def list_searches(path=None):
    init(path)
    with connect(path) as conn:
        rows = conn.execute("SELECT * FROM searches ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, name").fetchall()
        return [_search(row) for row in rows]


def get_search(search_id, path=None):
    init(path)
    with connect(path) as conn:
        row = conn.execute("SELECT * FROM searches WHERE id=?", (search_id,)).fetchone()
        return _search(row) if row else None


def list_findings(search_id=None, status=None, limit=100, path=None):
    init(path)
    clauses, values = [], []
    if search_id:
        clauses.append("search_id=?")
        values.append(search_id)
    if status and status != "all":
        clauses.append("status=?")
        values.append(status)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with connect(path) as conn:
        rows = conn.execute(
            f"SELECT * FROM findings {where} ORDER BY COALESCE(score, 0) DESC, discovered_at DESC LIMIT ?",
            (*values, max(1, min(int(limit), 500))),
        ).fetchall()
        return [_finding(row) for row in rows]


def _finding(row):
    item = dict(row)
    item["is_free"] = bool(item["is_free"])
    item["score_reasons"] = _json(item.pop("score_reasons_json"), [])
    item["raw"] = _json(item.pop("raw_json"), {})
    return item


def upsert_finding(finding, path=None):
    init(path)
    now = utc_now()
    values = {
        "id": finding.get("id") or f"{finding['search_id']}:{finding['source_id']}",
        "search_id": finding["search_id"],
        "kind": finding["kind"],
        "title": finding.get("title") or "Untitled finding",
        "source": finding.get("source") or "unknown",
        "source_id": finding["source_id"],
        "url": finding.get("url") or "",
        "image_url": finding.get("image_url") or "",
        "price": finding.get("price"),
        "is_free": 1 if finding.get("is_free") or finding.get("price") == 0 else 0,
        "location": finding.get("location") or "",
        "description": finding.get("description") or "",
        "score": finding.get("score"),
        "score_reasons_json": json.dumps(finding.get("score_reasons") or []),
        "discovered_at": finding.get("discovered_at") or now,
        "freshness": finding.get("freshness") or "new",
        "company": finding.get("company") or "",
        "role": finding.get("role") or "",
        "salary": finding.get("salary") or "",
        "fit_score": finding.get("fit_score"),
        "application_status": finding.get("application_status") or "not-reviewed",
        "raw_json": json.dumps(finding.get("raw") or finding),
    }
    with connect(path) as conn:
        conn.execute(
            """
            INSERT INTO findings (id,search_id,kind,title,source,source_id,url,image_url,price,is_free,location,description,score,score_reasons_json,discovered_at,freshness,status,company,role,salary,fit_score,application_status,raw_json,created_at,updated_at)
            VALUES (:id,:search_id,:kind,:title,:source,:source_id,:url,:image_url,:price,:is_free,:location,:description,:score,:score_reasons_json,:discovered_at,:freshness,'new',:company,:role,:salary,:fit_score,:application_status,:raw_json,:created_at,:updated_at)
            ON CONFLICT(search_id,source_id) DO UPDATE SET
              title=excluded.title,image_url=excluded.image_url,price=excluded.price,is_free=excluded.is_free,
              location=excluded.location,description=excluded.description,score=excluded.score,
              score_reasons_json=excluded.score_reasons_json,discovered_at=excluded.discovered_at,
              freshness=excluded.freshness,company=excluded.company,role=excluded.role,salary=excluded.salary,
              fit_score=excluded.fit_score,application_status=excluded.application_status,raw_json=excluded.raw_json,updated_at=excluded.updated_at
            """,
            {**values, "created_at": now, "updated_at": now},
        )


def record_run(search_id, status, counts, errors=None, started_at=None, finished_at=None, path=None):
    init(path)
    started = started_at or utc_now()
    finished = finished_at or utc_now()
    runtime = None
    try:
        runtime = (datetime.fromisoformat(finished) - datetime.fromisoformat(started)).total_seconds()
    except ValueError:
        pass
    run_id = str(uuid.uuid4())
    with connect(path) as conn:
        conn.execute(
            "INSERT INTO runs (id,search_id,started_at,finished_at,status,runtime_seconds,fetched_count,retained_count,rejected_count,notification_count,source_errors_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (run_id, search_id, started, finished, status, runtime, counts.get("fetched", 0), counts.get("retained", 0), counts.get("rejected", 0), counts.get("notifications", 0), json.dumps(errors or [])),
        )
        conn.execute("UPDATE searches SET last_run_id=?, updated_at=? WHERE id=?", (run_id, now if (now := utc_now()) else now, search_id))
    return run_id


def list_operations(search_id=None, limit=20, path=None):
    init(path)
    with connect(path) as conn:
        if search_id:
            rows = conn.execute("SELECT * FROM runs WHERE search_id=? ORDER BY started_at DESC LIMIT ?", (search_id, limit)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?", (limit,)).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["source_errors"] = _json(item.pop("source_errors_json"), [])
            result.append(item)
        return result


def apply_finding_action(finding_id, action, path=None):
    allowed = {"save", "dismiss", "contacted", "purchased", "applied", "expired", "restore"}
    if action not in allowed:
        raise ValueError(f"unknown finding action: {action}")
    mapping = {"save": "saved", "dismiss": "dismissed", "contacted": "contacted", "purchased": "purchased", "applied": "applied", "expired": "expired", "restore": "new"}
    init(path)
    with connect(path) as conn:
        row = conn.execute("SELECT id FROM findings WHERE id=?", (finding_id,)).fetchone()
        if not row:
            return False
        now = utc_now()
        conn.execute("UPDATE findings SET status=?, updated_at=? WHERE id=?", (mapping[action], now, finding_id))
        conn.execute("INSERT INTO finding_actions (id,finding_id,action,created_at) VALUES (?,?,?,?)", (str(uuid.uuid4()), finding_id, action, now))
        return True


def apply_search_action(search_id, action, path=None):
    allowed = {"run", "pause", "resume", "complete"}
    if action not in allowed:
        raise ValueError(f"unknown search action: {action}")
    statuses = {"pause": "paused", "resume": "active", "complete": "completed"}
    init(path)
    with connect(path) as conn:
        row = conn.execute("SELECT id FROM searches WHERE id=?", (search_id,)).fetchone()
        if not row:
            return False
        if action != "run":
            conn.execute("UPDATE searches SET status=?, updated_at=? WHERE id=?", (statuses[action], utc_now(), search_id))
        return True


def update_search(search_id, changes, path=None):
    init(path)
    allowed = {"name", "schedule", "status"}
    with connect(path) as conn:
        row = conn.execute("SELECT profile_json FROM searches WHERE id=?", (search_id,)).fetchone()
        if not row:
            return False
        profile = _json(row["profile_json"], {})
        for key in ("keywords", "budget", "location", "radius_miles", "vehicle", "size_constraints"):
            if key in changes:
                profile[key] = changes[key]
        fields, values = ["profile_json=?", "updated_at=?"], [json.dumps(profile), utc_now()]
        for key in allowed & changes.keys():
            fields.append(f"{key}=?")
            values.append(changes[key])
        values.append(search_id)
        conn.execute(f"UPDATE searches SET {', '.join(fields)} WHERE id=?", values)
        return True
