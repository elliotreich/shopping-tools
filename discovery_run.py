#!/usr/bin/env python3
"""Run one discovery search under an exclusive lock and record run health."""
import argparse
import fcntl
import os
import sys
import time
from pathlib import Path

import discovery_store as store
from discovery_sources import fetch_craigslist, load_jobs


def run(search_id):
    store.init()
    lock_path = Path(os.environ.get("DISCOVERY_LOCK_PATH", "/var/lock/shopping-tools-discovery.lock"))
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("another discovery run is active", file=sys.stderr)
            return 75
        started = store.utc_now()
        counts = {"fetched": 0, "retained": 0, "rejected": 0, "notifications": 0}
        errors = []
        try:
            search = store.get_search(search_id)
            if not search:
                raise ValueError(f"unknown search: {search_id}")
            if search["status"] in ("paused", "completed"):
                store.record_run(search_id, "skipped", counts, [f"search is {search['status']}"], started_at=started)
                return 0
            if search_id == "patio":
                findings = fetch_craigslist(search["profile"]["keywords"], search["profile"].get("budget", 50))
            elif search_id == "jobs":
                findings = load_jobs(os.environ.get("JOB_AGENTS_DIR", "/home/elliot/syncthing-shared/2_areas/Digital Systems/job-agents"))
            else:
                findings = []
            counts["fetched"] = len(findings)
            for finding in findings:
                store.upsert_finding(finding)
            counts["retained"] = len(findings)
            store.record_run(search_id, "succeeded", counts, errors, started_at=started)
            print(f"{search_id}: fetched={counts['fetched']} retained={counts['retained']}")
            return 0
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
            store.record_run(search_id, "failed", counts, errors, started_at=started)
            print(errors[0], file=sys.stderr)
            return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--search-id", required=True, choices=("patio", "jobs"))
    args = parser.parse_args()
    raise SystemExit(run(args.search_id))
