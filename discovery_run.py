#!/usr/bin/env python3
"""Run one discovery search under an exclusive lock and record run health."""
import argparse
import fcntl
import os
import sys
import time
from pathlib import Path

import discovery_store as store
from discovery_sources import fetch_craigslist_for_search, fetch_facebook_indexed, load_jobs


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
            findings = []
            source_ids = set()
            if search["kind"] == "jobs":
                findings = load_jobs(
                    os.environ.get("JOB_AGENTS_DIR", "/home/elliot/syncthing-shared/2_areas/Digital Systems/job-agents"),
                    profile=search["profile"],
                    search_id=search_id,
                )
            else:
                for adapter in search["source_adapters"]:
                    if adapter == "craigslist-indexed":
                        source_findings, source_errors, source_rejected = fetch_craigslist_for_search(search)
                    elif adapter == "facebook-public-indexed":
                        source_findings, source_errors, source_rejected = fetch_facebook_indexed(search)
                    else:
                        source_findings, source_errors, source_rejected = [], [f"unsupported source adapter: {adapter}"], 0
                    errors.extend(source_errors)
                    counts["rejected"] += source_rejected
                    for finding in source_findings:
                        if finding["source_id"] not in source_ids:
                            source_ids.add(finding["source_id"])
                            findings.append(finding)
            counts["fetched"] = len(findings)
            for finding in findings:
                store.upsert_finding(finding)
            store.expire_missing(search_id, [finding["source_id"] for finding in findings])
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
    parser.add_argument("--search-id", required=True, help="Stored search id to run")
    args = parser.parse_args()
    raise SystemExit(run(args.search_id))
