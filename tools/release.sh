#!/bin/zsh
# Publishes a new Ordo version for Homebrew:
#   1. universal Release build (Apple Silicon + Intel), ad-hoc signed
#   2. Ordo-<version>.zip onto the "releases" branch of this repo
#   3. version + sha256 into Casks/ordo.rb on main
# Usage: tools/release.sh 0.2.0      (then commit + push main)
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?Version angeben, z. B. tools/release.sh 0.2.0}"
remote=$(git remote get-url origin)

sed -i '' "s/MARKETING_VERSION: \".*\"/MARKETING_VERSION: \"$version\"/" project.yml
(cd web && node build.mjs)
xcodegen generate >/dev/null
xcodebuild -project Ordo.xcodeproj -scheme Ordo -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath build/release ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO build | grep -E "error:|BUILD" || true
app=build/release/Build/Products/Release/Ordo.app
[[ -d $app ]] || { echo "Build fehlgeschlagen"; exit 1; }

zip="Ordo-$version.zip"
rm -rf build/dist && mkdir -p build/dist
ditto -c -k --sequesterRsrc --keepParent "$app" "build/dist/$zip"
sha=$(shasum -a 256 "build/dist/$zip" | cut -d' ' -f1)

# zip onto the releases branch (separate history, keeps main small)
tmp=$(mktemp -d)
# read over HTTPS (public repo, no login); only the push uses the SSH remote
https=$(echo "$remote" | sed -E 's#^git@github.com:#https://github.com/#')
git clone -q --depth 1 --branch releases "$https" "$tmp" 2>/dev/null || git init -q -b releases "$tmp"
git -C "$tmp" remote remove origin 2>/dev/null; git -C "$tmp" remote add origin "$remote"
cp "build/dist/$zip" "$tmp/"
git -C "$tmp" add "$zip"
git -C "$tmp" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" commit -q -m "Ordo $version"
git -C "$tmp" push -q origin releases
rm -rf "$tmp"

sed -i '' -e "s/^  version \".*\"/  version \"$version\"/" -e "s/^  sha256 \".*\"/  sha256 \"$sha\"/" Casks/ordo.rb
echo "Fertig: $zip ($sha) – jetzt main committen und pushen."
