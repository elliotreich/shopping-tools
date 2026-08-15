"""Endpoint tests for server.py over a live ephemeral port.

SearXNG is fully mocked (search.query_retailer + search.ping) and the Menswear
Watcher DB is a temporary SQLite file, so the suite runs offline.
"""
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

from server import ShoppingToolsHandler, ShoppingToolsServer

from test_resale import SCHEMA, build_db


class ServerTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp.name, "seen.db")
        build_db(self.db_path)
        patcher = mock.patch("config.seen_db_path", return_value=self.db_path)
        patcher.start()
        self.addCleanup(patcher.stop)

        self.search_patcher = mock.patch("search.query_retailer")
        self.mock_query = self.search_patcher.start()
        self.addCleanup(self.search_patcher.stop)

        self.ping_patcher = mock.patch("search.ping", return_value=True)
        self.ping_patcher.start()
        self.addCleanup(self.ping_patcher.stop)

        self.server = ShoppingToolsServer(("127.0.0.1", 0), ShoppingToolsHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(
            target=self.server.serve_forever, daemon=True
        )
        self.thread.start()
        self.addCleanup(self._stop_server)

    def _stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def _get(self, path):
        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.port}{path}", timeout=10
        ) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8")), dict(resp.headers)

    def _get_status(self, path):
        try:
            self._get(path)
            return None
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))


class HealthTests(ServerTestCase):
    def test_health_ok(self):
        status, body, headers = self._get("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["service"], "shopping-tools-backend")
        self.assertTrue(body["checks"]["searxng"])
        self.assertTrue(body["checks"]["seen_db"])

    def test_health_cors_header(self):
        _, _, headers = self._get("/api/health")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")


class RetailersTests(ServerTestCase):
    def test_retailers_catalog(self):
        status, body, _ = self._get("/api/retailers")
        self.assertEqual(status, 200)
        ids = [r["id"] for r in body["retailers"]]
        self.assertEqual(
            ids,
            [
                "target",
                "walmart",
                "amazon",
                "homedepot",
                "costco",
                "cvs",
                "walgreens",
                "wholefoods",
                "traderjoes",
                "keyfood",
            ],
        )
        for retailer in body["retailers"]:
            for field in ("id", "name", "domain", "membership", "free_delivery"):
                self.assertIn(field, retailer)
            self.assertIn(".", retailer["domain"])


class SearchTests(ServerTestCase):
    def _fake_results(self):
        return [
            {
                "retailer": "target",
                "name": "Target",
                "domain": "target.com",
                "results": [
                    {
                        "title": "Levi's 501 | Target",
                        "url": "https://www.target.com/p/levi-s-501",
                        "snippet": "Free shipping over $35.",
                    }
                ],
                "error": None,
            },
            {
                "retailer": "walmart",
                "name": "Walmart",
                "domain": "walmart.com",
                "results": [],
                "error": "TimeoutError: boom",
            },
        ]

    def test_search_returns_blocks(self):
        self.mock_query.side_effect = [
            (
                {"id": "target", "name": "Target", "domain": "target.com"},
                self._fake_results()[0]["results"],
                None,
            ),
            (
                {"id": "walmart", "name": "Walmart", "domain": "walmart.com"},
                [],
                "TimeoutError: boom",
            ),
        ]
        status, body, _ = self._get("/api/search?q=levis+501&retailers=target,walmart")
        self.assertEqual(status, 200)
        self.assertEqual(body["source"], "searxng")
        self.assertEqual(body["query"], "levis 501")
        self.assertEqual(len(body["retailers"]), 2)
        self.assertEqual(len(body["retailers"][0]["results"]), 1)
        self.assertIn("TimeoutError", body["errors"][0])
        # each retailer was queried with its own site: domain
        calls = [c.args[1] for c in self.mock_query.call_args_list]
        self.assertIn("levis 501", calls[0])
        self.assertEqual(calls, ["levis 501", "levis 501"])

    def test_search_retailers_param(self):
        self.mock_query.side_effect = [
            ({"id": "target", "name": "Target", "domain": "target.com"}, [], None)
        ]
        _, body, _ = self._get("/api/search?q=jeans&retailers=target")
        self.assertEqual([b["retailer"] for b in body["retailers"]], ["target"])
        self.mock_query.assert_called_once()

    def test_search_retailers_all_keyword(self):
        self.mock_query.side_effect = [
            ({"id": r, "name": r, "domain": f"{r}.com"}, [], None)
            for r in (
                "target",
                "walmart",
                "amazon",
                "homedepot",
                "costco",
                "cvs",
                "walgreens",
                "wholefoods",
                "traderjoes",
                "keyfood",
            )
        ]
        _, body, _ = self._get("/api/search?q=jeans&retailers=all")
        self.assertEqual(len(body["retailers"]), 10)

    def test_search_missing_q_is_400(self):
        status, body = self._get_status("/api/search")
        self.assertEqual(status, 400)
        self.assertIn("q", body["error"])


class PrefillTests(ServerTestCase):
    def _fake_blocks(self):
        return [
            (
                {"id": "target", "name": "Target", "domain": "target.com"},
                [
                    {
                        "title": "Fruity Pebbles 18.9 oz $6.49 | Target",
                        "url": "https://www.target.com/p/fruity-pebbles",
                        "snippet": "",
                    }
                ],
                None,
            ),
            (
                {"id": "walgreens", "name": "Walgreens", "domain": "walgreens.com"},
                [
                    {
                        "title": "Fruity Pebbles 2 for $10 18.9 oz",
                        "url": "https://www.walgreens.com/p/fruity-pebbles",
                        "snippet": "",
                    }
                ],
                None,
            ),
        ]

    def test_prefill_returns_parsed_candidates(self):
        self.mock_query.side_effect = self._fake_blocks()
        status, body, _ = self._get(
            "/api/prefill?q=fruity+pebbles&retailers=target,walgreens"
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["source"], "searxng")
        self.assertEqual(body["count"], 2)
        target = body["candidates"][0]
        self.assertEqual(target["store"], "Target")
        self.assertEqual(target["price"], 6.49)
        self.assertEqual(target["size"], 18.9)
        self.assertEqual(target["unitType"], "weight")
        self.assertEqual(target["unit"], "oz")
        self.assertEqual(target["url"], "https://www.target.com/p/fruity-pebbles")
        walgreens = body["candidates"][1]
        self.assertEqual(walgreens["store"], "Walgreens")
        self.assertEqual(walgreens["deal"], {"type": "multi", "value": 2, "extra": 10})

    def test_prefill_missing_q_is_400(self):
        status, body = self._get_status("/api/prefill")
        self.assertEqual(status, 400)
        self.assertIn("q", body["error"])

    def test_prefill_keeps_errors(self):
        self.mock_query.side_effect = [
            (
                {"id": "amazon", "name": "Amazon", "domain": "amazon.com"},
                [],
                "TimeoutError: boom",
            )
        ]
        status, body, _ = self._get("/api/prefill?q=fruity+pebbles&retailers=amazon")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 0)
        self.assertIn("TimeoutError", body["errors"][0])


class StaticAppTests(ServerTestCase):
    def test_index_served(self):
        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.port}/app/index.html", timeout=10
        ) as resp:
            body = resp.read().decode("utf-8")
            self.assertEqual(resp.status, 200)
            self.assertIn("text/html", resp.headers.get("Content-Type", ""))
            self.assertIn("Shelf Scout", body)

    def test_app_root_serves_index(self):
        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.port}/app/", timeout=10
        ) as resp:
            body = resp.read().decode("utf-8")
            self.assertIn("Shelf Scout", body)

    def test_js_served(self):
        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.port}/app/app.js", timeout=10
        ) as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn("javascript", resp.headers.get("Content-Type", ""))

    def test_traversal_blocked(self):
        status, body = self._get_status("/app/../server.py")
        self.assertEqual(status, 403)
        self.assertIn("forbidden", body["error"])

    def test_missing_file_is_404(self):
        status, body = self._get_status("/app/nope.js")
        self.assertEqual(status, 404)
        self.assertIn("not found", body["error"])


class ResaleEndpointTests(ServerTestCase):
    def test_resale_listings(self):
        status, body, _ = self._get("/api/resale")
        self.assertEqual(status, 200)
        self.assertEqual(body["source"], "menswear-watcher")
        self.assertEqual(body["count"], 4)
        self.assertEqual(body["listings"][0]["id"], "grailed:zenga")

    def test_resale_limit_and_min_score(self):
        status, body, _ = self._get("/api/resale?limit=1&min_score=70")
        self.assertEqual(status, 200)
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["listings"][0]["score"], 90)

    def test_resale_invalid_limit_is_400(self):
        status, body = self._get_status("/api/resale?limit=abc")
        self.assertEqual(status, 400)
        self.assertIn("limit", body["error"])

    def test_resale_invalid_min_score_is_400(self):
        status, body = self._get_status("/api/resale?min_score=-5")
        self.assertEqual(status, 400)
        self.assertIn("min_score", body["error"])

    def test_resale_summary(self):
        status, body, _ = self._get("/api/resale/summary")
        self.assertEqual(status, 200)
        self.assertEqual(body["source"], "menswear-watcher")
        self.assertEqual(body["total_listings"], 4)
        self.assertEqual(body["high_score_count"], 2)


class CorsTests(ServerTestCase):
    def test_options_preflight(self):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/api/search",
            method="OPTIONS",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            self.assertEqual(resp.status, 204)
            self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), "*")
            self.assertIn("GET", resp.headers.get("Access-Control-Allow-Methods", ""))


class NotFoundTests(ServerTestCase):
    def test_unknown_path_is_404(self):
        status, body = self._get_status("/api/nope")
        self.assertEqual(status, 404)
        self.assertIn("not found", body["error"])

    def test_index_lists_endpoints(self):
        status, body, _ = self._get("/")
        self.assertEqual(status, 200)
        self.assertIn("/api/resale", body["endpoints"])


class ResaleEndpointMissingDbTests(unittest.TestCase):
    def test_resale_missing_db_is_503(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = os.path.join(tmp, "nope.db")
            server = ShoppingToolsServer(("127.0.0.1", 0), ShoppingToolsHandler)
            port = server.server_address[1]
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with mock.patch("config.seen_db_path", return_value=missing):
                    try:
                        urllib.request.urlopen(
                            f"http://127.0.0.1:{port}/api/resale", timeout=10
                        )
                        self.fail("expected HTTPError")
                    except urllib.error.HTTPError as exc:
                        self.assertEqual(exc.code, 503)
                        body = json.loads(exc.read().decode("utf-8"))
                        self.assertIn("cannot read database", body["error"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
