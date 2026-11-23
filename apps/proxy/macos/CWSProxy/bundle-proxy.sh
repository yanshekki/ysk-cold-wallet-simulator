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

# Homebrew Node is a 150KB wrapper plus ad-hoc libnode.147.dylib (no Team ID)
# and /opt/homebrew dylibs. Hardened runtime + App Sandbox reject that with
# "mapping process and mapped file (non-platform) have different Team IDs".
# Bundle the official darwin-arm64 tarball instead (same idea as the Ubuntu
# packager). CWS_NODE_BIN still overrides if it is already self-contained.
for stale in "$RESOURCES/node" "$RESOURCES"/libnode*.dylib; do
  if [ -e "$stale" ]; then
    chflags nouchg "$stale" 2>/dev/null || true
    chmod u+w "$stale" 2>/dev/null || true
    rm -f "$stale"
  fi
done

node_links_homebrew() {
  otool -L "$1" 2>/dev/null | grep -q '/opt/homebrew/'
}

resolve_bundled_node() {
  if [ -n "${CWS_NODE_BIN:-}" ]; then
    if [ ! -x "$CWS_NODE_BIN" ]; then
      echo "error: CWS_NODE_BIN is not executable: $CWS_NODE_BIN" >&2
      exit 1
    fi
    if node_links_homebrew "$CWS_NODE_BIN"; then
      echo "error: CWS_NODE_BIN is a Homebrew Node (links /opt/homebrew). Sandboxed CWS Proxy cannot load those dylibs. Unset CWS_NODE_BIN to bundle the official darwin-arm64 Node." >&2
      exit 1
    fi
    python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$CWS_NODE_BIN"
    return
  fi
  local version="${CWS_NODE_VERSION:-}"
  if [ -z "$version" ]; then
    local path_node
    path_node="$(command -v node || true)"
    if [ -n "$path_node" ]; then
      version="$("$path_node" -v)"
    else
      version="v26.9.0"
    fi
  fi
  if [ "$(uname -m)" != "arm64" ]; then
    echo "error: CWS Proxy bundles official Node darwin-arm64 only" >&2
    exit 1
  fi
  local cache="${SRCROOT}/DerivedData/cws-node-cache"
  mkdir -p "$cache"
  local name="node-${version}-darwin-arm64"
  local tarball="$cache/${name}.tar.xz"
  local url="https://nodejs.org/dist/${version}/${name}.tar.xz"
  if [ ! -f "$tarball" ]; then
    echo "download $url" >&2
    curl -fsSL --retry 3 -o "$tarball.partial" "$url"
    mv "$tarball.partial" "$tarball"
  fi
  local sums="$cache/SHASUMS256-${version}.txt"
  if [ ! -f "$sums" ]; then
    curl -fsSL --retry 3 -o "$sums" "https://nodejs.org/dist/${version}/SHASUMS256.txt"
  fi
  python3 - "$tarball" "$sums" "${name}.tar.xz" <<'PY'
import hashlib, os, sys
path, sums_path, want_name = sys.argv[1], sys.argv[2], sys.argv[3]
expect = None
with open(sums_path, encoding="utf-8") as handle:
    for line in handle:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == want_name:
            expect = parts[0]
            break
if not expect:
    os.remove(path)
    sys.stderr.write("no sha256 for %s in %s\n" % (want_name, sums_path))
    sys.exit(1)
digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
if digest != expect:
    os.remove(path)
    sys.stderr.write("sha256 mismatch for %s\n  got  %s\n  want %s\n" % (path, digest, expect))
    sys.exit(1)
PY
  local extracted="$cache/${name}"
  if [ ! -x "$extracted/bin/node" ]; then
    rm -rf "$extracted"
    mkdir -p "$extracted"
    tar -xJf "$tarball" -C "$cache"
  fi
  echo "$extracted/bin/node"
}

NODE_REAL="$(resolve_bundled_node)"
if [ ! -x "$NODE_REAL" ]; then
  echo "error: bundled node missing at $NODE_REAL" >&2
  exit 1
fi
cp "$NODE_REAL" "$RESOURCES/node"
chmod +x "$RESOURCES/node"
NODE_LIB="$(dirname "$NODE_REAL")/../lib"
shopt -s nullglob
for lib in "$NODE_LIB"/libnode*.dylib; do
  cp "$lib" "$RESOURCES/$(basename "$lib")"
  chmod u+w "$RESOURCES/$(basename "$lib")"
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
  SIGN_FLAGS=(--force --sign "$IDENTITY" --options runtime)
  if [ "${CONFIGURATION:-}" != "Debug" ]; then
    SIGN_FLAGS+=(--timestamp)
  fi
  codesign "${SIGN_FLAGS[@]}" \
    --identifier hk.ysk.cws.proxy.node \
    --entitlements "$ENTITLEMENTS" \
    "$RESOURCES/node"
  for lib in "$RESOURCES"/libnode*.dylib; do
    chmod u+w "$lib"
    codesign "${SIGN_FLAGS[@]}" --identifier hk.ysk.cws.proxy.libnode "$lib"
  done
  for lib in "$RESOURCES/proxy/node_modules/@cws/native-proxy"/*.node; do
    codesign "${SIGN_FLAGS[@]}" --identifier hk.ysk.cws.proxy.native "$lib"
  done
fi
