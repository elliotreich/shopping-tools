import json
import os
import tempfile
import unittest
from unittest.mock import patch

import discovery_store
from discovery_sources import CraigslistParser


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.temp.name, "discovery.sqlite3")

    def tearDown(self):
        self.temp.cleanup()

    def test_defaults_and_action_persist(self):
        with patch.dict(os.environ, {"DISCOVERY_DB_PATH": self.db}):
            discovery_store.init()
            self.assertEqual({"patio", "jobs"}, {item["id"] for item in discovery_store.list_searches()})
            discovery_store.upsert_finding({
                "search_id": "jobs", "kind": "jobs", "source": "test", "source_id": "job-1",
                "title": "Policy Analyst", "company": "Civic Lab", "role": "Policy Analyst",
                "url": "https://example.com/job-1", "score": 80, "score_reasons": ["NYC location"],
            })
            self.assertTrue(discovery_store.apply_finding_action("jobs:job-1", "save"))
            self.assertEqual("saved", discovery_store.list_findings("jobs", "saved")[0]["status"])

    def test_run_has_counts_and_errors(self):
        with patch.dict(os.environ, {"DISCOVERY_DB_PATH": self.db}):
            discovery_store.init()
            run_id = discovery_store.record_run("patio", "failed", {"fetched": 4, "retained": 2, "rejected": 2}, ["Craigslist timeout"])
            operation = discovery_store.list_operations("patio")[0]
            self.assertEqual(run_id, operation["id"])
            self.assertEqual(4, operation["fetched_count"])
            self.assertEqual(["Craigslist timeout"], operation["source_errors"])

    def test_search_exposes_next_run_for_installed_schedule(self):
        with patch.dict(os.environ, {"DISCOVERY_DB_PATH": self.db}):
            discovery_store.init()
            searches = {item["id"]: item for item in discovery_store.list_searches()}
            self.assertTrue(searches["patio"]["next_run_at"])
            self.assertTrue(searches["jobs"]["next_run_at"])
            discovery_store.apply_search_action("patio", "pause")
            self.assertIsNone(discovery_store.get_search("patio")["next_run_at"])
            discovery_store.apply_search_action("patio", "resume")
            self.assertTrue(discovery_store.get_search("patio")["next_run_at"])

    def test_missing_new_findings_become_expired(self):
        with patch.dict(os.environ, {"DISCOVERY_DB_PATH": self.db}):
            discovery_store.init()
            discovery_store.upsert_finding({
                "search_id": "jobs", "kind": "jobs", "source": "test", "source_id": "old",
                "title": "Old role", "url": "https://example.com/old",
            })
            self.assertEqual(1, discovery_store.expire_missing("jobs", ["current"]))
            self.assertEqual("expired", discovery_store.list_findings("jobs", "expired")[0]["status"])


class SourceTests(unittest.TestCase):
    def test_craigslist_static_results_parse(self):
        parser = CraigslistParser()
        parser.feed('''<li class="cl-static-search-result" title="FREE patio table"><a href="https://www.craigslist.org/view/d/x/abc"><div class="title">FREE patio table</div><div class="price">$0</div><div class="location">Brooklyn</div></a></li>''')
        self.assertEqual("FREE patio table", parser.items[0]["title"])
        self.assertEqual(0, parser.items[0]["price"])
        self.assertEqual("Brooklyn", parser.items[0]["location"])


if __name__ == "__main__":
    unittest.main()
