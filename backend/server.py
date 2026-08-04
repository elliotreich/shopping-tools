"""HTTP backend for the Resale Watcher Mac app.

Stdlib only: http.server + sqlite3 + urllib. No third-party dependencies.

Run:
    python3 server.py                # env-driven, port 8091 by default
    SHOPPING_TOOLS_PORT=9000 python3 server.py
    python3 server.py --port 9000    # convenience CLI flag (overrides env)

Endpoints:
    GET /api/health            service status + resale-feed check
    GET /api/resale?limit=..&min_score=..  recent resale-feed listings
    GET /api/resale/summary    aggregate stats over the resale-feed store
"""
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import config
import resale

_MAX_QUERY_LEN = 200
_MAX_LIMIT = 500


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
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
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
            elif path == "/api/resale":
                self.handle_resale(params)
            elif path == "/api/resale/summary":
                self.handle_resale_summary()
            elif path in ("/", "/api"):
                self.handle_index()
            else:
                self._send_error_json(404, f"not found: {path}")
        except (BrokenPipeError, ConnectionResetError):
            pass  # client went away; nothing to do
        except Exception as exc:  # pragma: no cover - last-resort guard
            self._send_error_json(500, f"internal error: {type(exc).__name__}: {exc}")

    # ── Routes ───────────────────────────────────────────────────────────────
    def handle_index(self):
        self._send_json(
            {
                "service": config.APP_NAME,
                "version": config.APP_VERSION,
                "endpoints": [
                    "/api/health",
                    "/api/resale",
                    "/api/resale/summary",
                ],
            }
        )

    def handle_health(self):
        db_path = config.seen_db_path()
        self._send_json(
            {
                "status": "ok",
                "service": config.APP_NAME,
                "version": config.APP_VERSION,
                "time": datetime.now(timezone.utc).isoformat(),
                "checks": {
                    "seen_db": os.path.exists(db_path),
                    "seen_db_path": db_path,
                },
            }
        )

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
                "source": "resale-feed",
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
        summary["source"] = "resale-feed"
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
