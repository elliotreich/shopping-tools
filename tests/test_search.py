"""Unit tests for search.py (SearXNG client + safe parsing).

All network access is mocked via unittest.mock — no real SearXNG is required.
"""
import unittest
from unittest import mock

import search


class ParseResultsTests(unittest.TestCase):
    def test_returns_safe_fields_only(self):
        payload = {
            "results": [
                {
                    "title": "Levi's 501 Jeans | Target",
                    "url": "https://www.target.com/p/levi-s-501-jeans",
                    "content": "Free shipping on orders over $35.",
                    "engine": "google",
                    "positions": [1],
                    "score": 0.9,
                }
            ]
        }
        results = search.parse_results(payload)
        self.assertEqual(len(results), 1)
        self.assertEqual(
            results[0],
            {
                "title": "Levi's 501 Jeans | Target",
                "url": "https://www.target.com/p/levi-s-501-jeans",
                "snippet": "Free shipping on orders over $35.",
            },
        )

    def test_drops_non_http_urls(self):
        payload = {"results": [{"title": "x", "url": "javascript:alert(1)"}]}
        self.assertEqual(search.parse_results(payload), [])

    def test_drops_missing_title_or_url(self):
        payload = {
            "results": [
                {"title": "", "url": "https://target.com/x"},
                {"title": "no url"},
                {"title": None, "url": "https://target.com/y"},
            ]
        }
        self.assertEqual(search.parse_results(payload), [])

    def test_deduplicates_by_url(self):
        payload = {
            "results": [
                {"title": "a", "url": "https://target.com/x"},
                {"title": "b", "url": "https://target.com/x"},
            ]
        }
        self.assertEqual(len(search.parse_results(payload)), 1)

    def test_uses_snippet_fallback(self):
        payload = {
            "results": [
                {"title": "a", "url": "https://target.com/x", "snippet": "fallback"}
            ]
        }
        self.assertEqual(search.parse_results(payload)[0]["snippet"], "fallback")

    def test_malformed_payload_is_empty(self):
        self.assertEqual(search.parse_results(None), [])
        self.assertEqual(search.parse_results({"results": "not-a-list"}), [])
        self.assertEqual(search.parse_results("garbage"), [])

    def test_control_characters_stripped(self):
        payload = {
            "results": [
                {
                    "title": "a\x00\x01b",
                    "url": "https://target.com/x",
                    "content": "line1\nline2\x7f",
                }
            ]
        }
        result = search.parse_results(payload)[0]
        self.assertEqual(result["title"], "ab")
        self.assertNotIn("\x7f", result["snippet"])

    def test_length_caps(self):
        payload = {
            "results": [
                {
                    "title": "t" * 5000,
                    "url": "https://target.com/x",
                    "content": "s" * 5000,
                }
            ]
        }
        result = search.parse_results(payload)[0]
        self.assertLessEqual(len(result["title"]), 301)  # cap + ellipsis
        self.assertLessEqual(len(result["snippet"]), 801)


class QueryRetailerTests(unittest.TestCase):
    @mock.patch("search.fetch_json")
    def test_success_builds_site_query(self, fetch):
        fetch.return_value = {
            "results": [
                {"title": "Levi's", "url": "https://www.target.com/p/x", "content": "c"}
            ]
        }
        retailer, results, err = search.query_retailer("target", "levis 501")
        self.assertIsNone(err)
        self.assertEqual(retailer["id"], "target")
        self.assertEqual(len(results), 1)
        args, _ = fetch.call_args
        search_url, params, timeout = args
        self.assertEqual(params["q"], "levis 501 site:target.com")
        self.assertEqual(params["format"], "json")

    @mock.patch("search.fetch_json")
    def test_failure_captured_as_error(self, fetch):
        fetch.side_effect = TimeoutError("timed out")
        retailer, results, err = search.query_retailer("walmart", "shoes")
        self.assertEqual(retailer["id"], "walmart")
        self.assertEqual(results, [])
        self.assertIn("timed out", err)

    @mock.patch("search.fetch_json")
    def test_http_error_captured(self, fetch):
        import urllib.error

        fetch.side_effect = urllib.error.HTTPError(
            "url", 429, "Too Many Requests", {}, None
        )
        _, results, err = search.query_retailer("amazon", "x")
        self.assertEqual(results, [])
        self.assertIn("429", err)

    def test_unknown_retailer(self):
        retailer, results, err = search.query_retailer("nope", "x")
        self.assertIsNone(retailer)
        self.assertEqual(results, [])
        self.assertIn("unknown retailer", err)

    @mock.patch("search.fetch_json")
    def test_results_capped(self, fetch):
        fetch.return_value = {
            "results": [
                {"title": f"r{i}", "url": f"https://target.com/{i}", "content": ""}
                for i in range(50)
            ]
        }
        _, results, _ = search.query_retailer("target", "x", max_results=5)
        self.assertEqual(len(results), 5)


class SearchTests(unittest.TestCase):
    @mock.patch("search.query_retailer")
    def test_selected_retailers_only(self, query_retailer):
        query_retailer.side_effect = [
            (
                {"id": "target", "name": "Target", "domain": "target.com"},
                [{"title": "t", "url": "https://target.com/x", "snippet": ""}],
                None,
            ),
            (
                {"id": "walmart", "name": "Walmart", "domain": "walmart.com"},
                [],
                "TimeoutError: boom",
            ),
        ]
        blocks, errors = search.search("jeans", ["target", "walmart"])
        self.assertEqual([b["retailer"] for b in blocks], ["target", "walmart"])
        self.assertEqual(len(blocks[0]["results"]), 1)
        self.assertEqual(blocks[1]["error"], "TimeoutError: boom")
        self.assertEqual(len(errors), 1)

    @mock.patch("search.query_retailer")
    def test_unknown_selected_id_lands_in_errors(self, query_retailer):
        query_retailer.return_value = (None, [], "unknown retailer: foo")
        blocks, errors = search.search("x", ["foo"])
        self.assertEqual(blocks, [])
        self.assertEqual(len(errors), 1)

    @mock.patch("search.ping")
    def test_ping_true_when_ok(self, ping):
        ping.return_value = True
        self.assertTrue(search.ping())
        ping.return_value = False
        self.assertFalse(search.ping())


if __name__ == "__main__":
    unittest.main()
