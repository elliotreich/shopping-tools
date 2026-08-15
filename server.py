"""HTTP backend for the Finder and Shopping Compass Mac apps.

Stdlib only: http.server + sqlite3 + urllib. No third-party dependencies.

Run:
    python3 server.py                # env-driven, port 8091 by default
    SHOPPING_TOOLS_PORT=9000 python3 server.py
    python3 server.py --port 9000    # convenience CLI flag (overrides env)

Endpoints:
    GET /api/health            service status + searxng/db checks
    GET /api/retailers         retailer catalog (Target, Walmart, Amazon, ...)
    GET /api/search?q=..&retailers=..   SearXNG site search per retailer
    GET /api/prefill?q=..&retailers=..  SearXNG results parsed into offers
    GET /api/resale?limit=..&min_score=..  recent Menswear Watcher listings
    GET /api/resale/summary    aggregate stats over the Menswear Watcher store
    GET /app/...               Shelf Scout web app (static files)
"""
import json
import os
import subprocess
import sys
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import config
import discovery_store
import prefill
import resale
import retailers
import search

_MAX_QUERY_LEN = 200
_MAX_LIMIT = 500

_STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ShelfScout")
_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
}


class ShoppingToolsServer(ThreadingHTTPServer):
    """Threaded HTTP server; daemon threads so shutdown never hangs on a
    long-running SearXNG request."""

    daemon_threads = True


class ShoppingToolsHandler(BaseHTTPRequestHandler):
    server_version = f"{config.APP_NAME}/{config.APP_VERSION}"

    # ── CORS ─────────────────────────────────────────────────────────────────
    def _cors_headers(self) -> dict:
        return {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With",
            "Access-Control-Max-Age": "86400",
        }

    def _send_cors(self):
        for key, value in self._cors_headers().items():
            self.send_header(key, value)

    # ── JSON helpers ─────────────────────────────────────────────────────────
    def _send_json(self, payload, status: int = 200):
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status: int, message: str):
        self._send_json({"error": message}, status)

    def _authorized(self):
        expected = config.discovery_api_token()
        if not expected:
            self._send_error_json(503, "DISCOVERY_API_TOKEN is not configured")
            return False
        if self.headers.get("Authorization", "") != f"Bearer {expected}":
            self._send_error_json(401, "missing or invalid bearer token")
            return False
        return True

    def log_message(self, fmt, *args):
        # Keep the stdlib request log line (stderr) but tag the app name.
        super().log_message(f"[{config.APP_NAME}] " + fmt, *args)

    # ── HTTP verbs ───────────────────────────────────────────────────────────
    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        params = urllib.parse.parse_qs(parsed.query)
        try:
            if path == "/api/health":
                self.handle_health()
            elif path == "/api/retailers":
                self.handle_retailers()
            elif path == "/api/search":
                self.handle_search(params)
            elif path == "/api/prefill":
                self.handle_prefill(params)
            elif path == "/api/resale":
                self.handle_resale(params)
            elif path == "/api/resale/summary":
                self.handle_resale_summary()
            elif path == "/api/discovery/searches":
                self.handle_discovery_searches(params)
            elif path == "/api/discovery/templates":
                self.handle_discovery_templates()
            elif path == "/api/discovery/findings":
                self.handle_discovery_findings(params)
            elif path == "/api/discovery/operations":
                self.handle_discovery_operations(params)
            elif path.startswith("/app/"):
                self._serve_static(path)
            elif path in ("/", "/api"):
                self.handle_index()
            else:
                self._send_error_json(404, f"not found: {path}")
        except (BrokenPipeError, ConnectionResetError):
            pass  # client went away; nothing to do
        except Exception as exc:  # pragma: no cover - last-resort guard
            self._send_error_json(500, f"internal error: {type(exc).__name__}: {exc}")

    def do_POST(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        if not path.startswith("/api/discovery/"):
            self._send_error_json(404, f"not found: {path}")
            return
        if not self._authorized():
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 100_000)
            body = json.loads(self.rfile.read(length) or b"{}")
            if path == "/api/discovery/searches":
                self.handle_discovery_search_create(body)
            elif path.startswith("/api/discovery/searches/") and path.endswith("/actions"):
                self.handle_discovery_search_action(path.split("/")[4], body.get("action"), body)
            elif path.startswith("/api/discovery/findings/") and path.endswith("/actions"):
                self.handle_discovery_finding_action(path.split("/")[4], body.get("action"))
            else:
                self._send_error_json(404, f"not found: {path}")
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._send_error_json(400, f"invalid request: {exc}")
        except Exception as exc:  # pragma: no cover
            self._send_error_json(500, f"internal error: {type(exc).__name__}: {exc}")

    # ── Routes ───────────────────────────────────────────────────────────────
    def handle_index(self):
        self._send_json(
            {
                "service": config.APP_NAME,
                "version": config.APP_VERSION,
                "endpoints": [
                    "/api/health",
                    "/api/retailers",
                    "/api/search",
                    "/api/prefill",
                    "/api/resale",
                    "/api/resale/summary",
                    "/api/discovery/searches",
                    "/api/discovery/templates",
                    "/api/discovery/findings",
                    "/api/discovery/operations",
                    "/app/",
                ],
            }
        )

    def handle_discovery_searches(self, params):
        if not self._authorized():
            return
        self._send_json({"searches": discovery_store.list_searches()})

    def handle_discovery_templates(self):
        if not self._authorized():
            return
        self._send_json({"templates": discovery_store.list_templates()})

    def handle_discovery_search_create(self, body):
        if body.get("action", "create") != "create":
            self._send_error_json(400, "search creation requires action=create")
            return
        try:
            search = discovery_store.create_search(
                body.get("template_id") or body.get("templateId"),
                name=body.get("name"),
                search_id=body.get("id"),
                schedule=body.get("schedule"),
                status=body.get("status", "paused"),
            )
        except (TypeError, ValueError) as exc:
            self._send_error_json(400, str(exc))
            return
        self._send_json({"search": search}, 201)

    def handle_discovery_findings(self, params):
        if not self._authorized():
            return
        search_id = (params.get("search_id") or [None])[0]
        status = (params.get("status") or ["new"])[0]
        limit = _int_param(params, "limit", 100)
        if limit is None or limit < 1:
            self._send_error_json(400, "limit must be a positive integer")
            return
        self._send_json({"findings": discovery_store.list_findings(search_id, status, limit)})

    def handle_discovery_operations(self, params):
        if not self._authorized():
            return
        search_id = (params.get("search_id") or [None])[0]
        self._send_json({"operations": discovery_store.list_operations(search_id)})

    def handle_discovery_search_action(self, search_id, action, body=None):
        if action == "edit":
            if not discovery_store.update_search(search_id, body or {}):
                self._send_error_json(404, "search not found")
                return
            self._send_json({"ok": True, "search_id": search_id, "action": action})
            return
        if action not in {"run", "pause", "resume", "complete"}:
            self._send_error_json(400, "action must be run, pause, resume, or complete")
            return
        if not discovery_store.apply_search_action(search_id, action):
            self._send_error_json(404, "search not found")
            return
        if action == "run":
            self._launch_discovery_run(search_id)
        self._send_json({"ok": True, "search_id": search_id, "action": action})

    def _launch_discovery_run(self, search_id):
        repo = os.path.dirname(os.path.abspath(__file__))
        log_dir = os.environ.get("DISCOVERY_LOG_DIR", "/tmp/shopping-tools-discovery")
        os.makedirs(log_dir, exist_ok=True)
        log = open(os.path.join(log_dir, f"{search_id}.log"), "ab")
        subprocess.Popen(
            [sys.executable, os.path.join(repo, "discovery_run.py"), "--search-id", search_id],
            cwd=repo,
            env=os.environ.copy(),
            stdout=log,
            stderr=log,
            start_new_session=True,
        )

    def handle_discovery_finding_action(self, finding_id, action):
        if not isinstance(action, str):
            self._send_error_json(400, "action is required")
            return
        try:
            found = discovery_store.apply_finding_action(finding_id, action)
        except ValueError as exc:
            self._send_error_json(400, str(exc))
            return
        if not found:
            self._send_error_json(404, "finding not found")
            return
        self._send_json({"ok": True, "finding_id": finding_id, "action": action})

    def handle_health(self):
        db_path = config.seen_db_path()
        self._send_json(
            {
                "status": "ok",
                "service": config.APP_NAME,
                "version": config.APP_VERSION,
                "time": datetime.now(timezone.utc).isoformat(),
                "checks": {
                    "searxng": search.ping(),
                    "seen_db": os.path.exists(db_path),
                    "seen_db_path": db_path,
                },
            }
        )

    def handle_retailers(self):
        self._send_json({"retailers": retailers.RETAILERS})

    def handle_search(self, params):
        query = (params.get("q") or [""])[0].strip()
        if not query:
            self._send_error_json(400, "missing required query parameter: q")
            return
        query = query[:_MAX_QUERY_LEN]
        selected = _parse_retailer_param(params.get("retailers"))
        blocks, errors = search.search(query, selected)
        self._send_json(
            {
                "query": query,
                "source": "searxng",
                "retailers": blocks,
                "errors": errors,
            }
        )

    def handle_prefill(self, params):
        query = (params.get("q") or [""])[0].strip()
        if not query:
            self._send_error_json(400, "missing required query parameter: q")
            return
        query = query[:_MAX_QUERY_LEN]
        selected = _parse_retailer_param(params.get("retailers"))
        candidates, errors = prefill.prefill(query, selected)
        self._send_json(
            {
                "query": query,
                "source": "searxng",
                "count": len(candidates),
                "candidates": candidates,
                "errors": errors,
            }
        )

    def _serve_static(self, path):
        rel = path[len("/app/"):] or "index.html"
        if rel.endswith("/"):
            rel += "index.html"
        target = os.path.realpath(os.path.join(_STATIC_DIR, rel))
        base = os.path.realpath(_STATIC_DIR)
        if not target.startswith(base + os.sep) and target != base:
            self._send_error_json(403, "forbidden")
            return
        if not os.path.isfile(target):
            self._send_error_json(404, f"not found: {path}")
            return
        ext = os.path.splitext(target)[1].lower()
        content_type = _CONTENT_TYPES.get(ext, "application/octet-stream")
        try:
            with open(target, "rb") as fh:
                body = fh.read()
        except OSError:
            self._send_error_json(500, "static read error")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._send_cors()
        self.end_headers()
        self.wfile.write(body)

    def handle_resale(self, params):
        limit = _int_param(params, "limit", 50)
        if limit is None or not (1 <= limit <= _MAX_LIMIT):
            self._send_error_json(
                400, f"limit must be an integer between 1 and {_MAX_LIMIT}"
            )
            return
        min_score = _float_param(params, "min_score", 0)
        if min_score is None or min_score < 0:
            self._send_error_json(400, "min_score must be a non-negative number")
            return
        listings, err = resale.list_listings(limit=limit, min_score=min_score)
        if err:
            self._send_error_json(503, err)
            return
        self._send_json(
            {
                "source": "menswear-watcher",
                "count": len(listings),
                "limit": limit,
                "min_score": min_score,
                "listings": listings,
            }
        )

    def handle_resale_summary(self):
        summary, err = resale.summary()
        if err:
            self._send_error_json(503, err)
            return
        summary["source"] = "menswear-watcher"
        self._send_json(summary)


# ── Param parsing ────────────────────────────────────────────────────────────
def _int_param(params, name: str, default: int):
    values = params.get(name)
    if not values:
        return default
    try:
        return int(values[0])
    except (TypeError, ValueError):
        return None


def _float_param(params, name: str, default: float):
    values = params.get(name)
    if not values:
        return default
    try:
        return float(values[0])
    except (TypeError, ValueError):
        return None


def _parse_retailer_param(raw_values) -> list:
    """Accept a comma-separated `retailers` param (or repeated params) and
    return the list of known retailer ids. Unknown ids are dropped; `all` or
    an empty/invalid selection falls back to every retailer."""
    if not raw_values:
        return retailers.ids()
    known = set(retailers.ids())
    picked = []
    for value in raw_values:
        for part in value.split(","):
            part = part.strip().lower()
            if not part or part in picked:
                continue
            if part == "all":
                return retailers.ids()
            if part in known:
                picked.append(part)
    return picked or retailers.ids()


# ── Entry point ──────────────────────────────────────────────────────────────
def _parse_cli_port(argv) -> int | None:
    """Extract --port/-p VALUE from argv; returns None when absent."""
    port = None
    i = 0
    while i < len(argv):
        if argv[i] in ("-p", "--port"):
            if i + 1 >= len(argv):
                raise SystemExit("--port requires a value")
            try:
                port = int(argv[i + 1])
            except ValueError:
                raise SystemExit(f"invalid --port value: {argv[i + 1]!r}")
            i += 2
        else:
            i += 1
    return port


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    cli_port = _parse_cli_port(argv)
    config.load_env_file()
    if cli_port is not None:
        os.environ["SHOPPING_TOOLS_PORT"] = str(cli_port)

    host, port = config.host(), config.port()
    server = ShoppingToolsServer((host, port), ShoppingToolsHandler)
    print(
        f"{config.APP_NAME} {config.APP_VERSION} listening on "
        f"http://{host}:{port}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
