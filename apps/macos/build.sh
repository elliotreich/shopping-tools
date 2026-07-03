#!/bin/bash
# Shopping Compass — Build macOS .app
# Usage: ./build.sh [release]

set -euo pipefail
cd "$(dirname "$0")"

CONFIG="${1:-debug}"
[ "$CONFIG" = "release" ] && SPM_CONFIG="release" BUILD_DIR=".build/release" || SPM_CONFIG="debug" BUILD_DIR=".build/debug"

PRODUCT="ShoppingCompassApp"
APP_NAME="Shopping Compass"
OUTPUT_DIR="$(pwd)/dist"

echo "🏗️  Building ${APP_NAME} ($SPM_CONFIG)..."

swift build -c "$SPM_CONFIG" --product "$PRODUCT"

APP_BUNDLE="${OUTPUT_DIR}/${APP_NAME}.app"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
cp "$BUILD_DIR/$PRODUCT" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

cat > "$APP_BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Shopping Compass</string>
  <key>CFBundleIdentifier</key>
  <string>com.elliotreich.ShoppingCompass</string>
  <key>CFBundleName</key>
  <string>Shopping Compass</string>
  <key>CFBundleDisplayName</key>
  <string>Shopping Compass</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsArbitraryLoads</key><true/></dict>
</dict>
</plist>
PLIST
echo -n "APPL????" > "$APP_BUNDLE/Contents/PkgInfo"
codesign --force --deep --sign - "$APP_BUNDLE" 2>/dev/null || true

echo "✅  ${APP_NAME}.app → dist/ ($(du -sh "$APP_BUNDLE" | cut -f1))"
