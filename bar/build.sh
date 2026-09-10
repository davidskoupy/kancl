#!/bin/bash
# Přeloží KanclBar.swift do bar/build/KanclBar.app (bez Xcode, stačí Command Line Tools).
set -euo pipefail
cd "$(dirname "$0")"
APP=build/KanclBar.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -swift-version 5 -o "$APP/Contents/MacOS/KanclBar" KanclBar.swift
cat > "$APP/Contents/Info.plist" <<'PL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>cz.skoupy.kanclbar</string>
  <key>CFBundleName</key><string>KanclBar</string>
  <key>CFBundleDisplayName</key><string>KanclBar</string>
  <key>CFBundleExecutable</key><string>KanclBar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>cz.skoupy.kanclbar</string><key>CFBundleURLSchemes</key><array><string>kanclbar</string></array></dict></array>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PL
# stabilní identita (bar/make-identity.sh) → povolení Přístupnosti přežije přeložení; jinak ad hoc
if security find-identity -v -p codesigning 2>/dev/null | grep -q "KanclBar Dev"; then
  codesign --force --sign "KanclBar Dev" --identifier cz.skoupy.kanclbar "$APP" 2>&1 | grep -v "replacing existing" || true
  echo "podpis: KanclBar Dev"
else
  codesign --force --sign - "$APP" >/dev/null 2>&1 || true
  echo "podpis: ad hoc (spusť bar/make-identity.sh, ať povolení Přístupnosti přežije další build)"
fi
echo "hotovo: $PWD/$APP"
