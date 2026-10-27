#!/bin/bash
set -euo pipefail

ROOT="${SRCROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
for _ in 1 2 3 4 5 6 7 8; do
  if [ -f "$ROOT/packages/contracts/package.json" ]; then
    break
  fi
  ROOT="$(dirname "$ROOT")"
done
if [ ! -f "$ROOT/packages/contracts/package.json" ]; then
  echo "error: could not find repo root from SRCROOT=${SRCROOT:-}" >&2
  exit 1
fi

RESOURCES="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"
mkdir -p "$RESOURCES/proxy/node_modules/@cws/native-proxy" "$RESOURCES/ui"

NODE_BIN="${CWS_NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ]; then
  echo "error: node not on PATH" >&2
  exit 1
fi
for stale in "$RESOURCES/node" "$RESOURCES"/libnode*.dylib; do
  if [ -e "$stale" ]; then
    chflags nouchg "$stale" 2>/dev/null || true
    chmod u+w "$stale" 2>/dev/null || true
    rm -f "$stale"
  fi
done
NODE_REAL="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$NODE_BIN")"
cp "$NODE_REAL" "$RESOURCES/node"
chmod +x "$RESOURCES/node"
NODE_LIB="$(dirname "$NODE_REAL")/../lib"
shopt -s nullglob
for lib in "$NODE_LIB"/libnode*.dylib; do
  cp "$lib" "$RESOURCES/$(basename "$lib")"
done

ESBUILD="$ROOT/node_modules/esbuild/bin/esbuild"
if [ ! -x "$ESBUILD" ]; then
  echo "error: esbuild missing. Run yarn at the repo root." >&2
  exit 1
fi
"$ESBUILD" "$ROOT/apps/proxy/src/main.ts" \
  --bundle \
  --platform=node \
  --format=cjs \
  --outfile="$RESOURCES/proxy/main.cjs" \
  --external:@cws/native-proxy

# Node 26 walks parents for package.json. Stop inside the .app so a
# sandboxed node binary never tries to read the repo (ERR_INVALID_PACKAGE_CONFIG).
printf '%s\n' '{"name":"cws-proxy-bundle","private":true,"type":"commonjs"}' \
  > "$RESOURCES/proxy/package.json"

NATIVE="$ROOT/packages/native-proxy"
cp "$NATIVE/index.js" "$RESOURCES/proxy/node_modules/@cws/native-proxy/index.js"
cp "$NATIVE/package.json" "$RESOURCES/proxy/node_modules/@cws/native-proxy/package.json"
if [ -f "$NATIVE/index.d.ts" ]; then
  cp "$NATIVE/index.d.ts" "$RESOURCES/proxy/node_modules/@cws/native-proxy/index.d.ts"
fi
shopt -s nullglob
NODE_ADDONS=("$NATIVE"/*.node)
if [ ${#NODE_ADDONS[@]} -eq 0 ]; then
  echo "error: native-proxy .node missing. Run: yarn workspace @cws/native-proxy build" >&2
  exit 1
fi
cp "${NODE_ADDONS[@]}" "$RESOURCES/proxy/node_modules/@cws/native-proxy/"

cp "$ROOT/apps/proxy/ui/"* "$RESOURCES/ui/"

IDENTITY="${EXPANDED_CODE_SIGN_IDENTITY:-}"
if [ -n "$IDENTITY" ] && [ "$IDENTITY" != "-" ]; then
  ENTITLEMENTS="$SRCROOT/CWSProxy/node.entitlements"
  codesign --force --sign "$IDENTITY" \
    --identifier hk.ysk.cws.proxy.node \
    --entitlements "$ENTITLEMENTS" \
    "$RESOURCES/node"
  for lib in "$RESOURCES/proxy/node_modules/@cws/native-proxy"/*.node; do
    codesign --force --sign "$IDENTITY" --identifier hk.ysk.cws.proxy.native "$lib"
  done
fi
