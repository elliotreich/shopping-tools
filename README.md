# Shopping Compass

Shopping Compass is a macOS app and self-hosted Python backend for comparing candidate listings across selected retailers.

This repository is independent. It contains no credentials, personal data, or shared hosted API. Each user runs the backend locally or on their own server and configures the app through **Settings**.

## Run the backend

The backend uses Python’s standard library and SearXNG’s JSON endpoint:

```bash
cd backend
python3 -m unittest discover -s tests -v
python3 server.py
curl http://127.0.0.1:8091/api/health
```

Set `SHOPPING_TOOLS_SEARXNG_URL` in `backend/.env` if SearXNG runs somewhere else. Search results are candidate links; verify exact identity, price, stock, delivery eligibility, and membership benefits at the retailer before purchase.

## Build the app

Install Xcode and XcodeGen:

```bash
xcodegen generate
xcodebuild -project ShoppingCompass.xcodeproj -scheme ShoppingCompass build
```

The app defaults to `http://127.0.0.1:8091/api`. Use the app’s Settings panel for a different backend URL; use HTTPS for remote deployments.

## License

MIT. See [LICENSE](backend/LICENSE).
