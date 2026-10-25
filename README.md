# YSK Cold Wallet Simulator

BLE-only cold wallet simulator (Ledger / Trezor / OneKey) built with ysk-kit style Expo monorepo.

**Project:** `ysk-cold-wallet-simulator`

See `docs/ARCHITECTURE.md` for the full design.

## Quick Start

```bash
yarn
cd apps/mobile
npx expo prebuild
npx expo run:android   # or run:ios
```

**Requires physical device.** BLE peripheral does not work in simulators or Expo Go.

Ledger BLE testnet host (desktop Chrome, no USB):

```bash
yarn lab
```

Open the printed localhost URL, start radio on a physical iPhone advertising a Ledger model, then Connect Ledger (Bluetooth). Signing still confirms on the phone.

Desktop wallets that only speak USB HID can use the phone through a local gadget:

```bash
yarn workspace @cws/native-proxy build   # once, needs Rust
yarn proxy                               # opens http://127.0.0.1:8788 — Start, then MetaMask / Rabby / Phantom / Keplr → Ledger over “USB”
```

The local page is on/off plus live radio, HID, and logs. The daemon stays the BLE/HID process. `--no-ui` scans immediately without the page. Signing still confirms on the phone. Linux needs `apps/proxy/udev/99-cws-uhid.rules`. Trezor Suite talks to `http://127.0.0.1:21325`. Do not expect Ledger Live Genuine to pass.

macOS virtual HID runs inside the signed **CWS Proxy** app (`apps/proxy/macos/CWSProxy`, bundle `hk.ysk.cws.proxy`). Open that app (Xcode Run / `yarn workspace @cws/proxy app`). The development profile must include this Mac’s provisioning UDID (`0000xxxx-…` from `xcodebuild -showdestinations`), not only the Hardware UUID. `yarn proxy` is the Linux / headless path.
