"""HTTP backend for the Shopping Compass Mac app.

Stdlib only: http.server + sqlite3 + urllib. No third-party dependencies.

Run:
    python3 server.py                # env-driven, port 8091 by default
    SHOPPING_TOOLS_PORT=9000 python3 server.py
    python3 server.py --port 9000    # convenience CLI flag (overrides env)

Endpoints:
    GET /api/health            service status + SearXNG check
    GET /api/retailers         retailer catalog (Target, Walmart, Amazon, ...)
    GET /api/search?q=..&retailers=..   SearXNG site search per retailer
"""
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import config
import retailers
import search

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
            elif path == "/api/retailers":
                self.handle_retailers()
            elif path == "/api/search":
                self.handle_search(params)
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
                    "/api/retailers",
                    "/api/search",
                ],
            }
        )

    def handle_health(self):
        self._send_json(
            {
                "status": "ok",
                "service": config.APP_NAME,
                "version": config.APP_VERSION,
                "time": datetime.now(timezone.utc).isoformat(),
                "checks": {
                    "searxng": search.ping(),
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

# ── Param parsing ────────────────────────────────────────────────────────────
def _int_param(params, name: str, default: int):
    values = params.get(name)
    if not values:
        return default
    try:
        return int(values[0])
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
