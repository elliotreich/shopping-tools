# Implementation Notes — Shopping Tools Backend

Date: 2026-08-15
Status: unified discovery implementation complete and locally verified; VPS scheduler cutover remains an explicit deployment step.

## What was built

A dependency-light Python backend (stdlib only) for two Mac SwiftUI clients:

- **Shopping Compass** — current-retailer price/search comparison
  (`/api/search` → local SearXNG).
- **Resale Watcher** — unified visual review app for patio, chairs, menswear, and jobs
  (`/api/resale`, `/api/resale/summary`).
- **Discovery Review** — one authenticated search/run/finding store for goods
  profiles and jobs, with a SwiftUI review/control surface.

### Module layout

```
Shopping Tools/
├── server.py              HTTP server (ThreadingHTTPServer), routing, CORS
├── config.py              env-driven config (SHOPPING_TOOLS_*)
├── retailers.py           static retailer catalog (Target/Walmart/Amazon/HD/Costco)
├── search.py              SearXNG client + safe result parsing
├── resale.py              read-only seen.db access + summary
├── tests/                 unittest suite (offline: mocked SearXNG, temp sqlite)
├── README.md
├── .env.example
├── .gitignore
└── implementation-notes.md
```

## Design decisions

1. **Stdlib only.** `http.server.ThreadingHTTPServer` + `sqlite3` + `urllib`.
   No requirements.txt needed; a new person runs it from the README with
   `python3 server.py`.

2. **Read-only Menswear Watcher data.** The DB is opened with
   `sqlite3.connect("file:<path>?mode=ro", uri=True)` **plus**
   `PRAGMA query_only = 1`. A missing file raises instead of silently
   creating an empty DB. Test `test_read_only_no_files_created` asserts no
   journal/WAL/SHM files appear next to the DB, and
   `test_read_only_cannot_write` asserts DDL/DML is rejected.

3. **Per-retailer isolation in search.** Each retailer is queried
   independently with its own timeout; a failing/rate-limited retailer
   produces an `error` entry and never sinks the request. Per-block `error`
   plus a top-level `errors` list gives the Mac app both a per-retailer view
   and a quick "anything wrong?" scan.

4. **Safe result parsing.** Only `title`/`url`/`snippet` are forwarded from
   SearXNG payloads; results without a title or an http(s) URL are dropped;
   URLs are deduplicated; control characters are stripped; title/snippet/URL
   are length-capped. Nothing else from upstream is exposed.

5. **Health never fails.** `/api/health` returns 200 with `checks.searxng`
   and `checks.seen_db` booleans so the Mac app can show degraded state
   without treating the whole service as down.

6. **Threaded server with daemon threads** so a slow SearXNG request can't
   block shutdown; each search request has its own urllib timeout.

7. **Env-driven config at call time** (functions, not frozen constants) so
   tests patch cleanly and `.env`/env overrides behave predictably. Real env
   always wins over `.env` (via `os.environ.setdefault`).

## Findings / gotchas encountered

1. **Spec DB path vs actual DB path.** The spec says
   `/home/elliot/Projects/1_projects/Menswear Watcher/seen.db`, but on this
   VPS the live file is at
   `/home/elliot/syncthing-shared/1_projects/Menswear Watcher/seen.db`.
   Resolution: `SHOPPING_TOOLS_DB_PATH` default = the spec path; the smoke
   check ran with the env override to the real file. README + `.env.example`
   document both. No magic auto-fallback was added (keeps "another person
   runs it" predictable).

2. **SearXNG rejects query-less requests (400).** The first `/api/health`
   reported `searxng: false` because the ping sent only `format=json`.
   Fixed to send `q=health`. Verified: `?format=json` alone → HTTP 400,
   `?q=test&format=json` → HTTP 200.

3. **SearXNG engines were rate-limited at test time** (brave/duckduckgo/
   startpage suspended). `/api/search` still returns 200 with empty results
   and no errors — correct graceful behavior.

4. **Menswear Watcher data quirks observed (read-only, not fixed):**
   - `seen.price` can be `NULL` *or* empty-string-ish; normalized to JSON
     `null` in the API.
   - `seen.first_seen` uses SQLite `datetime('now')` format
     (`2026-07-26 20:01:35`) while `run_stats.ts` uses Python ISO format
     (`2026-07-26T20:00:02.245418`). Both sort lexicographically, so
     ordering is safe.
   - `brand_hint` is scorer-supplied and sometimes disagrees with the title
     (e.g. a "Dior" listing tagged `brand_hint = "Borrelli"`). The API
     surfaces the stored value as-is; it does not second-guess the watcher.
   - `score_json.measurements` holds fit data (`{"size_tag": "42s"}`, chest,
     etc.); surfaced only when present.

5. **Bash background-process pitfall (tooling, not code):** `pkill -f` with a
   path containing spaces matched the invoking shell's own command line and
   killed it. Use exact PID or a tighter pattern when stopping the server.

## API shapes (final)

- `GET /api/health` → `{status, service, version, time, checks:{searxng, seen_db, seen_db_path}}`
- `GET /api/retailers` → `{retailers:[{id,name,domain,membership,free_delivery}]}`
- `GET /api/search?q=..&retailers=..` → `{query, source:"searxng", retailers:[{retailer,name,domain,results:[{title,url,snippet}],error}], errors:[]}`
- `GET /api/resale?limit=..&min_score=..` → `{source:"menswear-watcher", count, limit, min_score, listings:[{id,platform,url,title,price,brand,score,first_seen,image_url,measurements?}]}`
- `GET /api/resale/summary` → `{source, total_listings, listings_with_price, high_score_count, high_score_threshold:70, avg_score, max_score, price_min/max/avg, top_brands, platforms, recent_runs}`
- Errors: 400 bad params, 404 unknown path, 503 DB unavailable. CORS
  `Access-Control-Allow-Origin: *` on every response; `OPTIONS` preflight 204.

## Test strategy

`python3 -m unittest discover -s tests -v` — 46 tests, all offline:

- `test_search.py` — parse safety (fields, http(s) only, dedupe, caps,
  control chars, malformed payloads) + mocked `fetch_json` for query building
  and error capture.
- `test_resale.py` — temp SQLite DB with the exact Menswear Watcher schema;
  ordering, min_score, limit, measurements presence, null price, brand
  fallback, summary stats, missing-DB errors, and the read-only guarantees.
- `test_server.py` — live ephemeral-port server with SearXNG mocked; all
  endpoints, CORS headers, OPTIONS preflight, 400/404/503 paths.

## Smoke check (local, 2026-08-03)

Started with:
`SHOPPING_TOOLS_DB_PATH=/home/elliot/syncthing-shared/1_projects/Menswear Watcher/seen.db SHOPPING_TOOLS_PORT=8091 python3 server.py`

- `/api/health` → `status: ok`, `searxng: true`, `seen_db: true` ✅
- `/api/retailers` → 5 retailers, ids `target, walmart, amazon, homedepot, costco` ✅
- `/api/search?q=levis+501+jeans&retailers=target,walmart` → 200, `source: searxng`,
  0 results per retailer (upstream engines rate-limited), `errors: []` ✅
- `/api/resale?limit=2` → 2 recent listings with score/price/brand/platform/
  title/url/first_seen ✅
- `/api/resale?min_score=70&limit=3` → 3 listings, measurements surfaced
  (`{"size_tag": "40r"}`, `{"size_tag": "40 r"}`, `{"size_tag": "40r"}`) ✅
- `/api/resale/summary` → 2424 listings, avg score 40.8, max 82, top brands
  (generic/Isaia/Borrelli/Brioni/Sartoria Solito), platforms ebay+grailed,
  10 recent runs ✅
- `OPTIONS /api/search` → 204 + full CORS headers ✅
- `GET /api/search` (no q) → 400; `GET /api/nope` → 404 ✅
- Confirmed `seen.db` untouched: mtime unchanged, no journal/WAL/SHM files ✅

## Unified discovery implementation — 2026-08-15

- Added shared templates for office chairs, garage chairs, patio tables,
  broader patio furniture, shelving, tools, appliances, and jobs.
- Added generic Craigslist and public/indexed Facebook adapters with profile
  budgets, free-item handling, transport notes, score reasons, and hard rejects.
- Added dynamic search creation from templates through the API and Mac app.
- Added one UTC scheduler that dispatches every active search through the same
  runner, lock, database, API, and operations history.
- Verified 80 Python tests, Python compilation, and the Resale Watcher and
  Shopping Compass macOS builds.

## Not done / future work

- Install and enable `shopping-discovery-scheduler.timer` on the VPS, disable
  the old patio/jobs timers, restart the discovery API, and verify the live
  seeded searches before removing the legacy Chair Finder cron.
- No auth. Fine for Tailscale/VPS-internal use; add a bearer token behind the
  reverse proxy if the API is ever exposed publicly.
- `/api/search` currently hits SearXNG per retailer serially. Parallelizing
  with a small thread pool would cut latency when all 5 retailers are
  selected (bounded by the existing per-retailer timeout).
- No pagination on `/api/resale` beyond `limit`; fine for 2.4k rows today.

## 2026-08-07 — Shelf Scout web app + prefill endpoint

- Added `ShelfScout/` (static web app, served at `/app/`): per-item store
  comparison normalized to oz / fl oz / count, with deals, delivery fees,
  membership waivers, and tax, ranked by true all-in per-unit price.
  Data persists in browser localStorage; Export/Import JSON for portability.
- Added `/api/prefill` (`prefill.py`): parses SearXNG result titles/snippets
  into offer candidates (price, size, unit, optional deal). `2 for $10`
  normalizes to per-item price so the client never double-counts a deal.
- Added `SHOPPING_TOOLS_SEARXNG_ENGINES` env knob (comma-separated engine
  override) for when SearXNG default engines are suspended/captcha-blocked.
- Extended retailer catalog with CVS, Walgreens, Whole Foods Market, Trader
  Joe's, Key Food (factual notes only).
- Deployed to the VPS runtime copy at
  `/home/elliot/Projects/1_projects/Shopping Tools` (systemd
  `shopping-tools.service` restarted; mirror at
  `/home/elliot/syncthing-shared/...` stays in sync via Syncthing).
- Live caveat: SearXNG's default engines (google/duckduckgo/brave/startpage/
  wikidata) are intermittently suspended with CAPTCHA/rate-limit errors, so
  prefill candidates come and go. One positive live capture observed
  (Walgreens Fruity Pebbles $4.99 / 11 oz / 15% off). Restoring engine health
  or adding a shopping-capable engine is the next step for reliable prefills.
