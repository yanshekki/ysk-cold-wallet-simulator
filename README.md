# YSK Cold Wallet Simulator

BLE-only cold wallet simulator (Ledger / Trezor / OneKey) built with ysk-kit style Expo monorepo.

**Project:** `ysk-cold-wallet-simulator`

See `docs/ARCHITECTURE.md` for the full design.

## Quick Start

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate
# Node 26 / Hermes builds may ship without corepack:
#   npm install -g yarn@1.22.22
yarn
cd apps/mobile
npx expo prebuild
npx expo run:android   # or run:ios
```

**Requires physical device.** BLE peripheral does not work in simulators or Expo Go.

Maestro (UI, no BLE) needs Java on `PATH`:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$JAVA_HOME/bin:$HOME/Library/Android/sdk/platform-tools:$HOME/.maestro/bin:$PATH"
maestro test apps/mobile/.maestro
# subset: maestro test --include-tags smoke apps/mobile/.maestro
```

If Yarn classic is missing from `PATH`, call the workspace binary: `node_modules/.bin/vitest run`.

Physical-iPhone Maestro needs full Xcode (`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`), `--apple-team-id K897VVZW77`, and a Maestro driver whose `IPHONEOS_DEPLOYMENT_TARGET` is ≥ 15 (Maestro 2.10 still ships 14.0). Until that driver builds, run the YAML on a machine with a compatible Xcode, or follow the manual BLE list.

Desktop host is **CWS Proxy** (USB HID gadget **and** the former testnet host catalog):

```bash
yarn workspace @cws/native-proxy build   # once, needs Rust
yarn proxy                               # opens http://127.0.0.1:8788
```

Start radio on a physical phone, press **Start** on the Proxy page, then use MetaMask / Rabby / Phantom / Keplr over virtual USB **or** open the **Testnet host** tab and run Ledger / OneKey / Trezor cases over the same BLE link. Signing still confirms on the phone.

Proxy UI tests (real Chrome clicks):

```bash
cd apps/proxy
yarn test:e2e
# Maestro web (proxy must already be on :8788):
maestro test apps/proxy/.maestro
```

The local page is on/off plus live radio, HID, Testnet host, and logs. The daemon stays the BLE/HID process. `--no-ui` scans immediately without the page. Linux needs `apps/proxy/udev/99-cws-uhid.rules`. Trezor Suite talks to `http://127.0.0.1:21325`. Do not expect Ledger Live Genuine to pass.

macOS virtual HID runs inside the signed **CWS Proxy** app (`apps/proxy/macos/CWSProxy`, bundle `hk.ysk.cws.proxy`). Open that app (Xcode Run / `yarn workspace @cws/proxy app`). The development profile must include this Mac’s provisioning UDID (`0000xxxx-…` from `xcodebuild -showdestinations`), not only the Hardware UUID. `yarn proxy` is the Linux / headless path.
