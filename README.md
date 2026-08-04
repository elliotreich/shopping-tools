# Shopping Tools

Two small, self-hostable macOS tools backed by one dependency-light Python API:

- **Shopping Compass** searches selected current retailers for candidate listings.
- **Resale Watcher** displays scored resale listings from a SQLite feed and opens them in the default browser.

This repository contains no credentials, personal data, retailer accounts, or deployment-specific paths. The resale endpoint accepts any SQLite database matching the documented schema below.

## Architecture

```text
macOS SwiftUI apps ──HTTP──> Python API ──> SearXNG (shopping search)
                                      └──> SQLite resale feed (read-only)
```

The API uses only Python’s standard library. SearXNG is optional for the resale app but required for live retailer search.

## Backend

```bash
python3 server.py
python3 -m unittest discover -s tests -v
curl http://127.0.0.1:8091/api/health
```

Configuration is optional; copy `.env.example` if needed. Set `SHOPPING_TOOLS_DB_PATH` to a SQLite resale database. The service opens it with SQLite read-only mode and never writes to it.

The resale schema is:

```sql
CREATE TABLE seen (
  listing_id TEXT PRIMARY KEY, platform TEXT, url TEXT, title TEXT,
  price REAL, brand_hint TEXT, score INTEGER, score_json TEXT,
  notified INTEGER DEFAULT 0, first_seen TEXT, image_url TEXT
);
CREATE TABLE run_stats (
  ts TEXT PRIMARY KEY, fetched INTEGER, new_listings INTEGER,
  scored_high INTEGER, notified INTEGER, errors TEXT
);
```

Endpoints:

- `GET /api/health`
- `GET /api/retailers`
- `GET /api/search?q=<query>&retailers=target,walmart`
- `GET /api/resale?limit=50&min_score=50`
- `GET /api/resale/summary`

Search results are candidate links from SearXNG, not a guarantee of exact-SKU identity, live price, stock, delivery eligibility, or membership-adjusted cost. Those values should be verified at the retailer before purchase.

## macOS apps

Install Xcode and XcodeGen, then:

```bash
xcodegen generate
xcodebuild -project ShoppingTools.xcodeproj -scheme ShoppingCompass build
xcodebuild -project ShoppingTools.xcodeproj -scheme ResaleWatcher build
```

The apps default to `http://127.0.0.1:8091/api`. Change `AppConfig.defaultAPI` in `Shared/Models.swift` or add a settings surface before distributing a build that points to another server. For a remote deployment, use HTTPS and remove the local HTTP exception from the app Info.plist.

Both apps include authored app icons in their asset catalogs:

- Shopping Compass: compass needle / retailer direction motif.
- Resale Watcher: resale loop / listing motif.

## Optional search providers

The current backend uses SearXNG so it can run without a paid API. A Tavily adapter can be added as an optional provider by implementing the same search interface and reading `TAVILY_API_KEY` from the environment at runtime. Never commit the key or place it in `.env.example`.

## Public-repository checklist

Before publishing a fork or deployment:

1. Configure the API URL for your own server.
2. Supply your own resale SQLite feed, or leave the resale endpoint disabled.
3. Use HTTPS for any non-local API.
4. Review retailer terms, robots rules, and rate limits for your jurisdiction and use case.
5. Run the backend test suite and both Xcode schemes.
6. Run the Impeccable detector over the SwiftUI surfaces after UI changes.

## License

Released under the MIT License. See [LICENSE](LICENSE).
