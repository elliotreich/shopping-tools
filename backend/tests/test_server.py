"""Endpoint tests for the Resale Watcher server over a live ephemeral port."""
import json
import os
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
        self.server = ShoppingToolsServer(("127.0.0.1", 0), ShoppingToolsHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self._stop_server)

    def _stop_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def _get(self, path):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}", timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8")), dict(resp.headers)

    def _get_status(self, path):
        try:
            self._get(path)
            return None
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))


class HealthTests(ServerTestCase):
    def test_health_ok(self):
        status, body, _ = self._get("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["service"], "resale-watcher-backend")
        self.assertTrue(body["checks"]["seen_db"])

    def test_health_cors_header(self):
        _, _, headers = self._get("/api/health")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")


class ResaleEndpointTests(ServerTestCase):
    def test_resale_listings(self):
        status, body, _ = self._get("/api/resale")
        self.assertEqual(status, 200)
        self.assertEqual(body["source"], "resale-feed")
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
        self.assertEqual(body["source"], "resale-feed")
        self.assertEqual(body["total_listings"], 4)
        self.assertEqual(body["high_score_count"], 2)


class CorsTests(ServerTestCase):
    def test_options_preflight(self):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/api/resale", method="OPTIONS")
        with urllib.request.urlopen(req, timeout=10) as resp:
            self.assertEqual(resp.status, 204)
            self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), "*")


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
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(f"http://127.0.0.1:{port}/api/resale", timeout=10)
                    self.assertEqual(caught.exception.code, 503)
                    body = json.loads(caught.exception.read().decode("utf-8"))
                    self.assertIn("cannot read database", body["error"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)
