# Cold Wallet Simulator

BLE-only cold wallet simulator (Ledger / Trezor / OneKey) built with ysk-kit style Expo monorepo.

See `docs/ARCHITECTURE.md` for the full design.

## Quick Start

```bash
yarn
cd apps/mobile
npx expo prebuild
npx expo run:android   # or run:ios
```

**Requires physical device.** BLE peripheral does not work in simulators or Expo Go.
