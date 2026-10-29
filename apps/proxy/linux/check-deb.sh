#!/bin/bash
# Verify a hk.ysk.cws.proxy .deb.
#
# With no arguments, build a layout-check amd64 package (ELF stubs, not
# installable) and verify that. On Ubuntu, pass the real .deb instead:
#   bash apps/proxy/linux/check-deb.sh apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
set -euo pipefail

LINUX_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$LINUX_DIR/../../.." && pwd)"
UDEV="$ROOT/apps/proxy/udev/99-cws-uhid.rules"

if [[ $# -gt 1 ]]; then
  echo "usage: check-deb.sh [package.deb]" >&2
  exit 2
fi

if [[ $# -eq 1 ]]; then
  DEB="$1"
else
  echo "no package path given; building a layout-check deb" >&2
  DEB="$("$LINUX_DIR/build-deb.sh" --layout-check --arch amd64 | tail -n 1)"
fi

if [[ ! -f "$DEB" ]]; then
  echo "package not found: $DEB" >&2
  exit 1
fi

python3 "$LINUX_DIR/verify_deb.py" "$DEB" --udev "$UDEV"
