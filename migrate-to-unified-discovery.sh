#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_UNIFIED_DISCOVERY_MIGRATION:-}" != "YES" ]]; then
  echo "Refusing live cutover. Re-run with CONFIRM_UNIFIED_DISCOVERY_MIGRATION=YES after reviewing the unit changes." >&2
  exit 2
fi

repo_dir="${1:-/home/elliot/apps/shopping-tools}"
unit_dir="/etc/systemd/system"

sudo install -m 0644 "$repo_dir/shopping-discovery-runner@.service" "$unit_dir/shopping-discovery-runner@.service"
sudo install -m 0644 "$repo_dir/shopping-discovery-scheduler.service" "$unit_dir/shopping-discovery-scheduler.service"
sudo install -m 0644 "$repo_dir/shopping-discovery-scheduler.timer" "$unit_dir/shopping-discovery-scheduler.timer"
sudo systemctl daemon-reload

# The old per-search timers would duplicate the scheduler. The legacy Chair
# Finder Syncthing cron is intentionally not edited here; review/remove that
# line separately after the new scheduler has passed a live smoke run.
sudo systemctl disable --now shopping-discovery-patio.timer shopping-discovery-jobs.timer
sudo systemctl enable --now shopping-discovery-scheduler.timer
sudo systemctl restart shopping-tools-discovery.service

echo "Unified discovery scheduler is installed and the API service was restarted."
echo "Check: systemctl status shopping-discovery-scheduler.timer shopping-tools-discovery.service"
echo "Next: remove the legacy Chair Finder cron only after the scheduler smoke run is verified."
