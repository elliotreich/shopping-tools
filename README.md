# Resale Watcher

Resale Watcher is a macOS app and self-hosted Python backend for displaying scored resale listings from a read-only SQLite feed.

This repository is independent. It contains no credentials, personal data, or shared hosted API. Each user runs the backend locally or on their own server and configures the app through **Settings**.

## Run the backend

```bash
cd backend
python3 -m unittest discover -s tests -v
python3 server.py
curl http://127.0.0.1:8091/api/health
```

Set `SHOPPING_TOOLS_DB_PATH` in `backend/.env` to a SQLite database with the documented `seen` and `run_stats` tables. The backend opens it read-only and never modifies it.

## Build the app

Install Xcode and XcodeGen:

```bash
xcodegen generate
xcodebuild -project ResaleWatcher.xcodeproj -scheme ResaleWatcher build
```

The app defaults to `http://127.0.0.1:8091/api`. Use the app’s Settings panel for a different backend URL; use HTTPS for remote deployments.

## License

MIT. See [LICENSE](backend/LICENSE).
