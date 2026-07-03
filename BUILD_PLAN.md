# Shopping Compass — Build Plan

## What gets built

### Backend (Node.js → VPS, Tailscale-only)
- Fastify API server + SQLite DB
- 5 store scrapers: Amazon, Walmart, Target, CVS, Walgreens
- Generic scraper for user-added stores
- Free-inference matcher (DeepSeek V4 Flash via OpenCode CLI)
- Amazon list import script (reads your existing JSON exports)
- Seed data: store list, imported products

### macOS App (SwiftUI, primary)
- Sidebar + content split view
- My Lists, Item Detail with price comparison grid, Search, Store Manager
- In-app URL paste → scrapes all stores

### iOS App (SwiftUI, secondary, shares ~80% code)
- Tab bar: Lists, Search, Stores
- Shared Swift Package for models/networking

## Execution plan — 3 parallel waves

### Wave 1 (all in parallel, zero dependencies)
| Task | Agent | Output |
|------|-------|--------|
| DB schema + seed | `swarm-coder` | `schema.sql`, `seed.sql`, `db.js` |
| Amazon scraper | `swarm-coder` | `scrapers/amazon.js` |
| Walmart scraper | `swarm-coder` | `scrapers/walmart.js` |
| Target scraper | `swarm-coder` | `scrapers/target.js` |
| CVS scraper | `swarm-coder` | `scrapers/cvs.js` |
| Walgreens scraper | `swarm-coder` | `scrapers/walgreens.js` |
| Generic scraper | `swarm-coder` | `scrapers/generic.js` |
| Matcher service | `swarm-coder` | `matcher/index.js` |
| Amazon import script | `swarm-coder` | `import/amazon-list.js` |
| Server + API routes | `swarm-coder` | `server.js`, `routes/*.js` |

### Wave 2 (parallel, needs API contract from Wave 1)
| Task | Agent | Output |
|------|-------|--------|
| Shared Swift models + networking | `swarm-coder` | `ShoppingCompassKit/` package |
| macOS app UI | `swarm-coder` | `ShoppingCompass-macOS/` project |
| iOS app UI | `swarm-coder` | `ShoppingCompass-iOS/` project |

### Wave 3 (sequential, needs everything working)
| Task | Agent | Output |
|------|-------|--------|
| Integration test + debugging | `swarm-debugger` | Working end-to-end |
| Package as macOS app | `swarm-coder` | `.app` bundle |

Each agent gets a detailed spec prompt with exact file paths, expected API contracts, and verification steps. They run independently and report results back for synthesis.

## Key design decisions (locked)
- **Backend:** Node.js + Fastify + better-sqlite3 (fast, no ORM)
- **Scraping:** Playwright on VPS for JS-heavy stores, plain fetch for simple pages
- **Matching:** Two-phase — Jaccard filter → LLM judge (free DeepSeek V4 Flash)
- **App:** SwiftUI, macOS 15+ / iOS 18+, shared package via local SPM
- **Networking:** `http://shopping-compass:PORT` over Tailscale
- **Auth:** Tailscale-only (no login screen)

## Architecture (data flow)
```
[macOS App] ──Tailscale──> [VPS Backend]
                              │
                    ┌─────────┼─────────┐
                    │         │         │
               [Scrapers] [Matcher]  [SQLite]
                    │         │
               [Store APIs]  [OpenCode CLI → Free LLM]
```

Ready to execute this end-to-end when you give the word.
