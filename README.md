# Shopping Tools Backend

HTTP backend for Mac SwiftUI clients:

- **Shopping Compass** — compares a product query across current retailers
  (Target, Walmart, Amazon, Home Depot, Costco) via a local SearXNG instance.
- **Resale Watcher** — read-only view of Menswear Watcher's scored resale
  listings (`seen.db`).
- **Discovery Review** — authenticated visual review inbox for patio goods and
  job findings, with run health and persistent review actions. All recurring
  searches use this one runner, database, API, and Mac app.

Zero third-party dependencies: Python stdlib only (`http.server`, `sqlite3`,
`urllib`, `json`). The legacy backend runs on port **8091**; the authenticated
Discovery Review API runs on port **8092** from the committed VPS checkout.

## Requirements

- Python 3.8+ (tested on 3.10)
- A local SearXNG instance for `/api/search` (JSON output enabled)
- Menswear Watcher's `seen.db` (only read; never written)

## Quick start

```bash
cp .env.example .env   # optional — everything has sensible defaults
python3 server.py
# shopping-tools-backend 1.0.0 listening on http://0.0.0.0:8091
```

Verify:

```bash
curl http://127.0.0.1:8091/api/health
curl 'http://127.0.0.1:8091/api/search?q=levis+501&retailers=target,walmart'
curl 'http://127.0.0.1:8091/api/resale?limit=5&min_score=50'
```

Port is configurable via `SHOPPING_TOOLS_PORT` (env) or `--port` (CLI flag).
`SHOPPING_TOOLS_DB_PATH` points at your Menswear Watcher `seen.db` — see
[Configuration](#configuration).

## Discovery Review

The review app uses `/api/discovery/*` and a canonical SQLite database outside
the code checkout. Every request requires `Authorization: Bearer <token>`;
the token is supplied by `DISCOVERY_API_TOKEN` and is never stored in Git.

The unified workflow seeds these searches:

- `office-chair` — the proper ergonomic office-chair need, normally completed
  after the one-time purchase.
- `garage-chair` — a separate compact, comfortable garage-chair search, normally
  paused until needed.
- `patio` — the active dogfood search for indexed Craigslist NYC-area
  patio/table results, including price,
  source link, location, score reasons, and image URLs where indexed metadata
  provides them. Facebook Marketplace uses a constrained public/indexed
  adapter; logged-in collection remains a separate browser-session workflow.
- `patio-furniture` — broader outdoor chairs, benches, and sets.
- `shelving` — storage shelves, bookcases, and garage racks.
- `tools` — hand tools and workshop equipment.
- `appliances` — small appliances that can fit the Accord.
- `jobs` — persisted records from the existing `job-agents/jobs-*.json` files,
  normalized into the same finding model with company, role, location, salary,
  fit score, source link, and application status. Jobs are a separate finding
  kind, but still use the same review inbox and operations history.

Goods searches default to free or under $50, 11367/NYC-area pickup, and Honda
Accord transport constraints. One-time goods searches are seeded paused; patio
and jobs are seeded active. Search profiles are templates, not separate repos.

Run ingestion locally or from the committed VPS checkout:

```bash
DISCOVERY_DB_PATH=/path/outside/checkout/discovery.sqlite3 \
DISCOVERY_LOCK_PATH=/path/outside/checkout/discovery.lock \
JOB_AGENTS_DIR=/path/to/job-agents \
python3 discovery_run.py --search-id patio
```

API routes:

- `GET /api/discovery/searches`
- `GET /api/discovery/templates`
- `POST /api/discovery/searches` with `template_id`, `id`, `name`, `schedule`,
  and `status` to create another search from a shared profile template.
- `GET /api/discovery/findings?search_id=patio&status=new&limit=100`
- `GET /api/discovery/operations?search_id=patio`
- `POST /api/discovery/searches/<id>/actions` with `run`, `pause`, `resume`, `complete`, or `edit` (the edit body may update name, keywords, budget, location, and schedule)
- `POST /api/discovery/findings/<id>/actions` with `save`, `dismiss`, `contacted`, `purchased`, `applied`, `expired`, or `restore`

The committed `shopping-discovery-runner@.service` is the per-search execution
unit. The unified `shopping-discovery-scheduler.service` and timer dispatch all
active searches from their stored schedules, with one shared lock and run
history. Install the scheduler only after the checkout and outside-checkout
data directories exist, and disable the legacy patio/jobs timers during the
cutover so a search cannot run twice.

The review API is isolated on port `8092` while the legacy Shopping Tools
service remains on `8091`; this permits a controlled migration without
interrupting the existing retailer/resale clients. The Mac app defaults to
`8092`. The API's `OPTIONS` response permits authenticated `POST` actions for
browser-style clients as well as the native Mac app.

## Endpoints

All responses are JSON and carry `Access-Control-Allow-Origin: *` so the Mac
apps can call them directly. `OPTIONS` preflight is handled.

### `GET /api/health`

Service status plus lightweight dependency checks (never fails on a missing
dependency — the Mac app reads `checks`).

```json
{
  "status": "ok",
  "service": "shopping-tools-backend",
  "version": "1.0.0",
  "time": "2026-08-03T23:50:38+00:00",
  "checks": {
    "searxng": true,
    "seen_db": true,
    "seen_db_path": "/home/elliot/.../seen.db"
  }
}
```

### `GET /api/retailers`

Static retailer catalog (Target, Walmart, Amazon, Home Depot, Costco) with
domains and membership/free-delivery notes.

```json
{
  "retailers": [
    {
      "id": "target",
      "name": "Target",
      "domain": "target.com",
      "membership": false,
      "free_delivery": "No membership required. Free standard shipping on orders over $35..."
    }
  ]
}
```

### `GET /api/search?q=<query>&retailers=<ids>`

Queries SearXNG once per selected retailer with `site:<domain>` appended.
`retailers` is optional, comma-separated; `all` or omitting it selects every
retailer. Only `title`/`url`/`snippet` are returned, and only http(s) URLs
with non-empty titles are kept.

```json
{
  "query": "levis 501 jeans",
  "source": "searxng",
  "retailers": [
    {
      "retailer": "target",
      "name": "Target",
      "domain": "target.com",
      "results": [
        {
          "title": "Levi's 501 Original Fit Jeans - Target",
          "url": "https://www.target.com/p/levi-s-501-original-fit-jeans",
          "snippet": "Shop Target for Levi's 501 jeans..."
        }
      ],
      "error": null
    }
  ],
  "errors": []
}
```

One failing retailer never sinks the request: its block has an `error` string
and a copy lands in the top-level `errors` list. A 400 is returned when `q` is
missing.

### `GET /api/prefill?q=<query>&retailers=<ids>`

Same SearXNG search as `/api/search`, but each result's title/snippet is parsed
into an offer candidate: price, size, unit type, unit, and an optional deal
(`% off`, `$ off`, BOGO, N-for-$). Used by the Shelf Scout web app to prefill
the add-offer form. Candidates without a parseable price and size are dropped;
a `2 for $10` deal is normalized to its per-item price (`5.00`).

```json
{
  "query": "fruity pebbles",
  "source": "searxng",
  "count": 1,
  "candidates": [
    {
      "store": "Target",
      "retailerId": "target",
      "url": "https://www.target.com/p/fruity-pebbles-18-9-oz",
      "title": "Fruity Pebbles 18.9 oz $6.49 | Target",
      "price": 6.49,
      "size": 18.9,
      "unitType": "weight",
      "unit": "oz",
      "deal": null
    }
  ],
  "errors": []
}
```

### `GET /app/`

Serves the Shelf Scout web app (static files from `./ShelfScout`): a price
comparator that normalizes across units, adds delivery fees and membership
waivers, applies deals, and ranks offers by true all-in per-unit cost. Data
stays in the browser's localStorage; Export/Import JSON moves it elsewhere.

### `GET /api/resale?limit=<n>&min_score=<s>`

Recent Menswear Watcher listings ordered by `first_seen` desc.
`limit` (1–500, default 50) and `min_score` (default 0) are optional.
`measurements` is included only when the listing has them. The database is
opened with SQLite `mode=ro` + `PRAGMA query_only`, so this endpoint can never
modify Menswear Watcher data.

```json
{
  "source": "menswear-watcher",
  "count": 3,
  "limit": 3,
  "min_score": 70,
  "listings": [
    {
      "id": "ebay:257026628606",
      "platform": "ebay",
      "url": "https://www.ebay.com/itm/257026628606",
      "title": "$3,000 ISAIA - PEAK LAPEL Black Wool Tuxedo...",
      "price": 3000.0,
      "brand": "Isaia",
      "score": 44,
      "first_seen": "2026-07-26 20:01:35",
      "image_url": "",
      "measurements": { "size_tag": "42s" }
    }
  ]
}
```

Returns **503** with an error message if the database cannot be opened.

### `GET /api/resale/summary`

Aggregate stats over the Menswear Watcher store: totals, score distribution,
price stats, top brands, platforms, and the 10 most recent watcher runs.

## Configuration

Everything is optional; defaults match the VPS setup. Real environment
variables win over `.env` (never commit `.env`).

| Variable | Default | Meaning |
|---|---|---|
| `SHOPPING_TOOLS_HOST` | `0.0.0.0` | Bind address |
| `SHOPPING_TOOLS_PORT` | `8091` | HTTP port |
| `SHOPPING_TOOLS_SEARXNG_URL` | `http://127.0.0.1:8888/search` | SearXNG JSON endpoint |
| `SHOPPING_TOOLS_DB_PATH` | `/home/elliot/Projects/1_projects/Menswear Watcher/seen.db` | Menswear Watcher SQLite store (read-only) |
| `SHOPPING_TOOLS_SEARCH_TIMEOUT` | `10` | Per-retailer SearXNG timeout (seconds) |
| `SHOPPING_TOOLS_MAX_RESULTS_PER_RETAILER` | `20` | Max results per retailer |
| `SHOPPING_TOOLS_SEARXNG_ENGINES` | *(empty)* | Comma-separated SearXNG engine override (e.g. `bing`) |

When SearXNG's default engines are suspended or CAPTCHA-blocked (common), pin a
working one: `SHOPPING_TOOLS_SEARXNG_ENGINES=bing`. The prefill quality is
bounded by what the configured engines return: no shopping category means
product pages with prices in titles are rare, so "no candidates" is the honest
result, not an error.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

The suite is fully offline: SearXNG is mocked, and resale tests run against a
temporary SQLite database with the exact Menswear Watcher schema. Tests also
assert the read-only guarantee (no files created next to the DB, writes
rejected).

## Data safety

The Menswear Watcher database is opened read-only at the SQLite level
(`file:...?mode=ro` URI + `PRAGMA query_only = 1`). A missing file is an
error, never a silently created database. This backend never writes anywhere.

## Deployment note

A systemd unit is intentionally **not** included yet. When ready, run it under
`python3 server.py` with the env vars above (the startup line already
flushes so it lands in journald).
