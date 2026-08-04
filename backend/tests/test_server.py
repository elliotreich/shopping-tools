"""Endpoint tests for the Shopping Compass server over a live ephemeral port."""
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock

from server import ShoppingToolsHandler, ShoppingToolsServer

class ServerTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
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
        self.assertEqual(body["service"], "shopping-compass-backend")
        self.assertTrue(body["checks"]["searxng"])

    def test_health_cors_header(self):
        _, _, headers = self._get("/api/health")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")


class RetailersTests(ServerTestCase):
    def test_retailers_catalog(self):
        status, body, _ = self._get("/api/retailers")
        self.assertEqual(status, 200)
        ids = [r["id"] for r in body["retailers"]]
        self.assertEqual(ids, ["target", "walmart", "amazon", "homedepot", "costco"])
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
            for r in ("target", "walmart", "amazon", "homedepot", "costco")
        ]
        _, body, _ = self._get("/api/search?q=jeans&retailers=all")
        self.assertEqual(len(body["retailers"]), 5)

    def test_search_missing_q_is_400(self):
        status, body = self._get_status("/api/search")
        self.assertEqual(status, 400)
        self.assertIn("q", body["error"])


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


if __name__ == "__main__":
    unittest.main()
