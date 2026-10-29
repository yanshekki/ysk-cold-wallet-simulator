#!/bin/bash
# Build an Ubuntu .deb for CWS Proxy (package hk.ysk.cws.proxy).
#
# On Ubuntu 22.04 or 24.04 (glibc >= 2.34), amd64 or arm64, from the repo root:
#   yarn
#   yarn workspace @cws/native-proxy build
#   bash apps/proxy/linux/build-deb.sh
#   bash apps/proxy/linux/check-deb.sh apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
#   sudo apt-get install -y ./apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
#
# The .deb is written under apps/proxy/dist/linux/ and is gitignored.
# This script does not attach anything to a GitHub Release.
#
# --layout-check packs ELF stubs so the archive can be inspected without a
# Linux addon. Do not apt-install that file.
set -euo pipefail

LINUX_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$LINUX_DIR/../../.." && pwd)"
PROXY="$ROOT/apps/proxy"
NATIVE="$ROOT/packages/native-proxy"

# Official Node.js 24 LTS linux tarballs. Hashes are from
# https://nodejs.org/dist/v24.22.2/SHASUMS256.txt
# Node needs glibc >= 2.28. The native addon built on Ubuntu 24.04 needs
# glibc >= 2.34, so the package depends on libc6 (>= 2.34): Ubuntu 22.04 and 24.04.
NODE_VERSION="v24.22.2"
NODE_SHA_X64="48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75"
NODE_SHA_ARM64="eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8"

ARCH="${CWS_DEB_ARCH:-}"
LAYOUT=0
REVISION="${CWS_DEB_REVISION:-1}"

usage() {
  cat <<'EOF' >&2
Usage: build-deb.sh [--arch amd64|arm64] [--layout-check]

  --arch           Debian architecture. Default: this machine (x86_64 -> amd64,
                   aarch64/arm64 -> arm64).
  --layout-check   Pack ELF stubs. The result is not a runnable Ubuntu build.

Environment:
  CWS_DEB_OUT       Output directory (default: apps/proxy/dist/linux)
  CWS_DEB_REVISION  Debian revision appended after '-' (default: 1)
  CWS_NATIVE_NODE   Path to native-proxy.linux-*-gnu.node if it is not in
                    packages/native-proxy/
  CWS_NODE_BIN      Path to a Linux Node ELF to bundle instead of the pinned tarball
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      ARCH="${2:-}"
      shift 2
      ;;
    --layout-check)
      LAYOUT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

host_deb_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf '%s\n' amd64 ;;
    aarch64|arm64) printf '%s\n' arm64 ;;
    *) printf '%s\n' unknown ;;
  esac
}

if [[ -z "$ARCH" ]]; then
  ARCH="$(host_deb_arch)"
fi

case "$ARCH" in
  amd64)
    NODE_DIST_ARCH="x64"
    NATIVE_NAME="native-proxy.linux-x64-gnu.node"
    NODE_SHA="$NODE_SHA_X64"
    ELF_MACHINE=62
    ;;
  arm64)
    NODE_DIST_ARCH="arm64"
    NATIVE_NAME="native-proxy.linux-arm64-gnu.node"
    NODE_SHA="$NODE_SHA_ARM64"
    ELF_MACHINE=183
    ;;
  *)
    echo "architecture must be amd64 or arm64 (got ${ARCH})" >&2
    exit 2
    ;;
esac

case "$REVISION" in
  ''|*[!0-9]*)
    echo "CWS_DEB_REVISION must be an integer" >&2
    exit 2
    ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to pack the .deb" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required on the build machine to read the app version and to bundle" >&2
  exit 1
fi

APP_JSON="$ROOT/apps/mobile/app.json"
VERSION="$(node -p "require(process.argv[1]).expo.version" "$APP_JSON")"
BUILD="$(node -p "String(require(process.argv[1]).expo.android.versionCode)" "$APP_JSON")"
case "$VERSION" in
  *[!0-9A-Za-z.]*)
    echo "refusing app version that is not a plain dotted version: $VERSION" >&2
    exit 1
    ;;
esac
case "$BUILD" in
  ''|*[!0-9]*)
    echo "refusing non-numeric build number: $BUILD" >&2
    exit 1
    ;;
esac

DEB_UPSTREAM="${VERSION}+build${BUILD}"
if [[ "$LAYOUT" -eq 1 ]]; then
  DEB_UPSTREAM="${DEB_UPSTREAM}+layout"
fi
DEB_VERSION="${DEB_UPSTREAM}-${REVISION}"

OUT_DIR="${CWS_DEB_OUT:-$ROOT/apps/proxy/dist/linux}"
mkdir -p "$OUT_DIR"
DEB_PATH="$OUT_DIR/hk.ysk.cws.proxy_${DEB_VERSION}_${ARCH}.deb"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/cws-proxy-stage.XXXXXX")"
CTRL="$(mktemp -d "${TMPDIR:-/tmp}/cws-proxy-control.XXXXXX")"
cleanup() {
  rm -rf "$STAGE" "$CTRL"
}
trap cleanup EXIT

LIB="$STAGE/usr/lib/hk.ysk.cws.proxy"
mkdir -p "$LIB/proxy/node_modules/@cws/native-proxy" \
  "$LIB/ui" \
  "$STAGE/usr/bin" \
  "$STAGE/usr/lib/udev/rules.d" \
  "$STAGE/usr/share/applications" \
  "$STAGE/usr/share/doc/hk.ysk.cws.proxy"

if [[ -x "$ROOT/node_modules/esbuild/bin/esbuild" ]]; then
  ESBUILD="$ROOT/node_modules/esbuild/bin/esbuild"
elif command -v esbuild >/dev/null 2>&1; then
  ESBUILD="$(command -v esbuild)"
else
  echo "esbuild is missing. From the repo root run: yarn" >&2
  exit 1
fi

echo "bundle proxy -> main.cjs" >&2
"$ESBUILD" "$PROXY/src/main.ts" \
  --bundle \
  --platform=node \
  --format=cjs \
  --target=node22 \
  --packages=bundle \
  --legal-comments=eof \
  --external:@cws/native-proxy \
  --banner:js='const __cwsRoot=require("path").join(require("path").dirname(process.execPath),"proxy","node_modules");if(!process.env.NODE_PATH){process.env.NODE_PATH=__cwsRoot;require("module").Module._initPaths();}' \
  --outfile="$LIB/proxy/main.cjs"
node --check "$LIB/proxy/main.cjs"
printf '%s\n' '{"name":"cws-proxy-bundle","private":true,"type":"commonjs"}' > "$LIB/proxy/package.json"

for ui_file in index.html styles.css i18n.js app.js; do
  cp "$PROXY/ui/$ui_file" "$LIB/ui/$ui_file"
done

cp "$NATIVE/index.js" "$LIB/proxy/node_modules/@cws/native-proxy/index.js"
cp "$NATIVE/package.json" "$LIB/proxy/node_modules/@cws/native-proxy/package.json"
cp "$PROXY/udev/99-cws-uhid.rules" "$STAGE/usr/lib/udev/rules.d/99-cws-uhid.rules"
cp "$LINUX_DIR/hk.ysk.cws.proxy.desktop" "$STAGE/usr/share/applications/hk.ysk.cws.proxy.desktop"
cp "$LINUX_DIR/debian/copyright" "$STAGE/usr/share/doc/hk.ysk.cws.proxy/copyright"
cp "$LINUX_DIR/debian/README.Debian" "$STAGE/usr/share/doc/hk.ysk.cws.proxy/README.Debian"
chmod 644 "$LIB/proxy/main.cjs" "$LIB/proxy/package.json" \
  "$LIB/proxy/node_modules/@cws/native-proxy/index.js" \
  "$LIB/proxy/node_modules/@cws/native-proxy/package.json" \
  "$LIB/ui/"* \
  "$STAGE/usr/lib/udev/rules.d/99-cws-uhid.rules" \
  "$STAGE/usr/share/applications/hk.ysk.cws.proxy.desktop" \
  "$STAGE/usr/share/doc/hk.ysk.cws.proxy/copyright" \
  "$STAGE/usr/share/doc/hk.ysk.cws.proxy/README.Debian"

cat > "$STAGE/usr/bin/cws-proxy" <<'EOF'
#!/bin/sh
# Launch the private Node runtime. ui/ and proxy/ sit beside that binary.
set -e
ROOT="/usr/lib/hk.ysk.cws.proxy"
export CWS_UI_DIR="${CWS_UI_DIR:-$ROOT/ui}"
export NODE_PATH="$ROOT/proxy/node_modules${NODE_PATH:+:$NODE_PATH}"
exec "$ROOT/node" "$ROOT/proxy/main.cjs" "$@"
EOF
chmod 755 "$STAGE/usr/bin/cws-proxy"

write_elf_stub() {
  python3 - "$1" "$2" <<'PY'
import sys
path, machine = sys.argv[1], int(sys.argv[2])
blob = bytearray(64)
blob[0:4] = b"\x7fELF"
blob[4] = 2
blob[5] = 1
blob[6] = 1
blob[16] = 3
blob[18] = machine & 0xFF
blob[19] = (machine >> 8) & 0xFF
blob[20] = 1
open(path, "wb").write(blob)
PY
}

assert_elf() {
  python3 - "$1" "$2" <<'PY'
import sys
path, machine = sys.argv[1], int(sys.argv[2])
blob = open(path, "rb").read(20)
ok = len(blob) >= 20 and blob[:4] == b"\x7fELF" and blob[4] == 2 and blob[5] == 1
got = int.from_bytes(blob[18:20], "little") if ok else None
if not ok or got != machine:
    sys.stderr.write("not an ELF for machine %s: %s\n" % (machine, path))
    sys.exit(1)
PY
}

ADDON_DEST="$LIB/proxy/node_modules/@cws/native-proxy/$NATIVE_NAME"
NODE_DEST="$LIB/node"

if [[ "$LAYOUT" -eq 1 ]]; then
  echo "layout check: writing ELF stubs, not a runnable node or addon" >&2
  write_elf_stub "$NODE_DEST" "$ELF_MACHINE"
  write_elf_stub "$ADDON_DEST" "$ELF_MACHINE"
  printf '%s\n' "layout-check stub. Do not install this package." \
    > "$STAGE/usr/share/doc/hk.ysk.cws.proxy/LAYOUT-CHECK"
  chmod 644 "$STAGE/usr/share/doc/hk.ysk.cws.proxy/LAYOUT-CHECK"
else
  NATIVE_SRC="${CWS_NATIVE_NODE:-$NATIVE/$NATIVE_NAME}"
  if [[ ! -f "$NATIVE_SRC" ]]; then
    if [[ "$(uname -s)" == "Linux" && "$(host_deb_arch)" == "$ARCH" ]]; then
      echo "building @cws/native-proxy for $ARCH" >&2
      (cd "$ROOT" && yarn workspace @cws/native-proxy build)
      NATIVE_SRC="$NATIVE/$NATIVE_NAME"
    fi
  fi
  if [[ ! -f "$NATIVE_SRC" ]]; then
    echo "missing $NATIVE_NAME" >&2
    echo "Build it on Ubuntu $ARCH, then re-run this script:" >&2
    echo "  sudo apt-get install -y build-essential pkg-config libdbus-1-dev" >&2
    echo "  yarn workspace @cws/native-proxy build" >&2
    exit 1
  fi
  cp "$NATIVE_SRC" "$ADDON_DEST"
  assert_elf "$ADDON_DEST" "$ELF_MACHINE"

  if [[ -n "${CWS_NODE_BIN:-}" ]]; then
    echo "using CWS_NODE_BIN=$CWS_NODE_BIN (not the pinned Node.js tarball)" >&2
    cp "$CWS_NODE_BIN" "$NODE_DEST"
  else
    CACHE="$OUT_DIR/cache"
    mkdir -p "$CACHE"
    TARBALL="$CACHE/node-${NODE_VERSION}-linux-${NODE_DIST_ARCH}.tar.xz"
    URL="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-${NODE_DIST_ARCH}.tar.xz"
    if [[ ! -f "$TARBALL" ]]; then
      echo "download $URL" >&2
      if ! command -v curl >/dev/null 2>&1; then
        echo "curl is required to download Node.js" >&2
        exit 1
      fi
      curl -fsSL --retry 3 -o "$TARBALL.partial" "$URL"
      mv "$TARBALL.partial" "$TARBALL"
    fi
    python3 - "$TARBALL" "$NODE_SHA" <<'PY'
import hashlib, os, sys
path, expect = sys.argv[1], sys.argv[2]
digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
if digest != expect:
    os.remove(path)
    sys.stderr.write("sha256 mismatch for %s\n  got  %s\n  want %s\n" % (path, digest, expect))
    sys.exit(1)
PY
    EXTRACT="$(mktemp -d "${TMPDIR:-/tmp}/cws-node.XXXXXX")"
    tar -xJf "$TARBALL" -C "$EXTRACT"
    cp "$EXTRACT/node-${NODE_VERSION}-linux-${NODE_DIST_ARCH}/bin/node" "$NODE_DEST"
    rm -rf "$EXTRACT"
  fi
  assert_elf "$NODE_DEST" "$ELF_MACHINE"
  printf '%s\n' "$NODE_VERSION" > "$STAGE/usr/share/doc/hk.ysk.cws.proxy/NODE-VERSION"
  chmod 644 "$STAGE/usr/share/doc/hk.ysk.cws.proxy/NODE-VERSION"
fi

chmod 755 "$NODE_DEST" "$ADDON_DEST"

python3 - "$LIB/proxy/main.cjs" "$STAGE/usr/bin/cws-proxy" <<'PY'
import sys
markers = (b"BEGIN PRIVATE KEY", b"BEGIN RSA PRIVATE KEY", b"BEGIN OPENSSH PRIVATE KEY")
for path in sys.argv[1:]:
    blob = open(path, "rb").read()
    for marker in markers:
        if marker in blob:
            sys.stderr.write("refusing to pack %s from %s\n" % (marker.decode(), path))
            sys.exit(1)
PY

INSTALLED_SIZE="$(python3 - "$STAGE" <<'PY'
import os, sys
total = 0
for dirpath, _dirs, files in os.walk(sys.argv[1]):
    for name in files:
        total += os.path.getsize(os.path.join(dirpath, name))
print((total + 1023) // 1024)
PY
)"

cp "$LINUX_DIR/debian/postinst" "$LINUX_DIR/debian/prerm" "$LINUX_DIR/debian/postrm" "$CTRL/"
chmod 755 "$CTRL/postinst" "$CTRL/prerm" "$CTRL/postrm"

LAYOUT_NOTE=""
if [[ "$LAYOUT" -eq 1 ]]; then
  LAYOUT_NOTE=" .
 This is a layout-check package. The node binary and the native addon are
 ELF stubs. Do not install this build."
fi

cat > "$CTRL/control" <<EOF
Package: hk.ysk.cws.proxy
Version: ${DEB_VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: YSK Limited <yanshekki@gmail.com>
Depends: bluez, libdbus-1-3, udev, libc6 (>= 2.34), libstdc++6, libgcc-s1
Recommends: xdg-utils
Homepage: https://github.com/yanshekki/ysk-cold-wallet-simulator
Bugs: https://github.com/yanshekki/ysk-cold-wallet-simulator/issues
Installed-Size: ${INSTALLED_SIZE}
Description: USB HID proxy for the CWS phone simulator
 CWS Proxy presents the phone simulator as a virtual USB HID device
 through /dev/uhid and serves http://127.0.0.1:8788.
 .
 Package id hk.ysk.cws.proxy. It installs the uhid udev rule and loads
 the uhid module when the package is configured.
 .
 This is a simulator for interoperability testing. It is not a secure
 element. Seeds are not absolutely safe. Do not hold real assets.
${LAYOUT_NOTE}
EOF

echo "pack $DEB_PATH" >&2
python3 "$LINUX_DIR/pack_deb.py" --stage "$STAGE" --control "$CTRL" --output "$DEB_PATH"
echo "$DEB_PATH"
