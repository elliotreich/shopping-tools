"""Run all active searches whose schedule matches the current UTC minute."""
import argparse
from datetime import datetime, timezone

import discovery_store as store
from discovery_run import run


def schedule_matches(schedule, now=None):
    now = now or datetime.now(timezone.utc)
    fields = str(schedule).split()
    if len(fields) != 5 or fields[2:] != ["*", "*", "*"]:
        return False
    try:
        minute_values = {int(value) for value in fields[0].split(",")}
        hour_values = {int(value) for value in fields[1].split(",")}
    except ValueError:
        return False
    return now.minute in minute_values and now.hour in hour_values


def already_ran_this_minute(search_id, now=None):
    now = now or datetime.now(timezone.utc)
    operations = store.list_operations(search_id, limit=1)
    if not operations:
        return False
    try:
        started = datetime.fromisoformat(operations[0]["started_at"])
    except (TypeError, ValueError):
        return False
    return started.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M") == now.strftime("%Y-%m-%dT%H:%M")


def run_due(now=None):
    now = now or datetime.now(timezone.utc)
    results = []
    for search in store.list_searches():
        if search["status"] != "active" or not schedule_matches(search["schedule"], now):
            continue
        if already_ran_this_minute(search["id"], now):
            continue
        results.append((search["id"], run(search["id"])))
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--at", help="UTC ISO timestamp for deterministic checks")
    args = parser.parse_args()
    timestamp = datetime.fromisoformat(args.at).replace(tzinfo=timezone.utc) if args.at else None
    print(run_due(timestamp))
