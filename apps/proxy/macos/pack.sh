#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PROXY="$ROOT/apps/proxy"
MACOS="$PROXY/macos"
DIST="$PROXY/dist"
APP="$DIST/CWS Proxy.app"
CONTENTS="$APP/Contents"
INNER="$CONTENTS/Helpers/CWS Node.app"
INNER_CONTENTS="$INNER/Contents"
IDENT="${CWS_CODESIGN_IDENTITY:?Set CWS_CODESIGN_IDENTITY to your Apple Development certificate name.}"
PROFILE="${CWS_PROFILE:?Set CWS_PROFILE to the path of a .provisionprofile.}"
if [[ ! -f "$PROFILE" ]]; then
  echo "provisioning profile not found: $PROFILE" >&2
  exit 1
fi

export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
NODE_BIN="$(node -p 'process.execPath')"

rm -rf "$DIST"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources/proxy/node_modules/@cws/native-proxy" "$CONTENTS/Resources/ui" \
  "$INNER_CONTENTS/MacOS"

cc -O2 -o "$CONTENTS/MacOS/CWSProxy" "$MACOS/launch.c"
cp "$NODE_BIN" "$INNER_CONTENTS/MacOS/CWSNode"
cp "$MACOS/Info.plist" "$CONTENTS/Info.plist"
cp "$MACOS/NodeInfo.plist" "$INNER_CONTENTS/Info.plist"
cp "$PROFILE" "$INNER_CONTENTS/embedded.provisionprofile"
cp "$PROXY/ui/index.html" "$PROXY/ui/styles.css" "$PROXY/ui/i18n.js" "$PROXY/ui/app.js" "$CONTENTS/Resources/ui/"

NATIVE="$ROOT/packages/native-proxy"
cp "$NATIVE/index.js" "$NATIVE/package.json" "$CONTENTS/Resources/proxy/node_modules/@cws/native-proxy/"
cp "$NATIVE/native-proxy.darwin-arm64.node" "$CONTENTS/Resources/proxy/node_modules/@cws/native-proxy/"

cd "$PROXY"
npx esbuild src/main.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --packages=bundle \
  --external:@cws/native-proxy \
  --banner:js="const __cwsNativeRoot=require('path').join(require('path').dirname(process.execPath),'../../../../Resources/proxy/node_modules');process.env.NODE_PATH=__cwsNativeRoot;require('module').Module._initPaths();" \
  --outfile="$CONTENTS/Resources/proxy/main.cjs"
printf '%s\n' '{"name":"cws-proxy-bundle","private":true,"type":"commonjs"}' \
  > "$CONTENTS/Resources/proxy/package.json"

python3 - <<'PY' "$PROFILE"
import os, plistlib, shutil, subprocess, sys
raw = subprocess.check_output(["security", "cms", "-D", "-i", sys.argv[1]])
plist = plistlib.loads(raw)
uuid = plist["UUID"]
dest_dirs = [
    os.path.expanduser("~/Library/Developer/Xcode/UserData/Provisioning Profiles"),
    os.path.expanduser("~/Library/MobileDevice/Provisioning Profiles"),
]
for folder in dest_dirs:
    os.makedirs(folder, exist_ok=True)
    dest = os.path.join(folder, f"{uuid}.provisionprofile")
    shutil.copy2(sys.argv[1], dest)
    print(f"installed profile {dest}")
PY

sign_hid() {
  codesign --force --identifier hk.ysk.cws.proxy \
    --sign "$IDENT" \
    --entitlements "$MACOS/cws-proxy.entitlements" \
    --timestamp=none \
    "$1"
}

sign_launcher() {
  codesign --force --identifier hk.ysk.cws.proxy.launcher \
    --sign "$IDENT" \
    --entitlements "$MACOS/launcher.entitlements" \
    --timestamp=none \
    "$1"
}

sign_hid "$CONTENTS/Resources/proxy/node_modules/@cws/native-proxy/native-proxy.darwin-arm64.node"
sign_hid "$INNER_CONTENTS/MacOS/CWSNode"
sign_hid "$INNER"
sign_launcher "$CONTENTS/MacOS/CWSProxy"
sign_launcher "$APP"

echo "signed $APP"
codesign -d --entitlements :- "$INNER_CONTENTS/MacOS/CWSNode" 2>/dev/null | head -20
