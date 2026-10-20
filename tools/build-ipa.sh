#!/bin/zsh
# Builds an unsigned Ordo.ipa for AltStore / SideStore (they sign it with your Apple ID).
# Needs the iOS platform in Xcode (Xcode › Settings › Components).
# Usage: tools/build-ipa.sh   → build.noindex/Ordo.ipa
set -euo pipefail
cd "$(dirname "$0")/.."

(cd web && node build.mjs)
xcodegen generate >/dev/null
xcodebuild -project Ordo.xcodeproj -scheme Ordo -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath build.noindex/ios \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build | grep -E "error:|BUILD" || true

app=build.noindex/ios/Build/Products/Release-iphoneos/Ordo.app
[[ -d $app ]] || { echo "Build fehlgeschlagen – ist die iOS-Plattform in Xcode installiert?"; exit 1; }
rm -rf build.noindex/ipa && mkdir -p build.noindex/ipa/Payload
cp -R "$app" build.noindex/ipa/Payload/
(cd build.noindex/ipa && zip -qr ../Ordo.ipa Payload)
echo "Fertig: build.noindex/Ordo.ipa"
