#!/bin/bash
# Build the macOS CWS Proxy app. Signing uses the Xcode project's team.
# Set CWS_CODESIGN_IDENTITY only when you must force a named certificate.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
args=(
  -project macos/CWSProxy/CWSProxy.xcodeproj
  -scheme "CWS Proxy"
  -configuration Debug
  -destination "generic/platform=macOS"
  -derivedDataPath macos/CWSProxy/DerivedData
  ARCHS=arm64
  ONLY_ACTIVE_ARCH=YES
  ENABLE_DEBUG_DYLIB=NO
  ENABLE_PREVIEWS=NO
  CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO
)
if [[ -n "${CWS_CODESIGN_IDENTITY:-}" ]]; then
  args+=(
    CODE_SIGN_STYLE=Manual
    "CODE_SIGN_IDENTITY=${CWS_CODESIGN_IDENTITY}"
  )
  if [[ -n "${CWS_PROFILE_SPECIFIER:-}" ]]; then
    args+=("PROVISIONING_PROFILE_SPECIFIER=${CWS_PROFILE_SPECIFIER}")
  fi
fi
xcodebuild "${args[@]}"
