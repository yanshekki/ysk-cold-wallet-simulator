# YSK Cold Wallet Simulator

**Version 1.1.0 (build 6)** · YSK Limited · bundle `hk.ysk.cws`

CWS is a phone application that simulates selected Bluetooth hardware wallets. The phone holds a BIP39 or SLIP-39 secret in OS secure storage and speaks the vendor protocol to a third-party wallet. A desktop proxy can present that phone as a USB HID device. Air-gap account export uses animated or static QR codes.

CWS is a simulator for development and interoperability testing. It is not a secure element, it is not endorsed by Ledger, Trezor, or OneKey, and it must not be used to hold real digital assets.

中文說明（香港書面語）：[docs/zh-HK.md](docs/zh-HK.md)

**Seeds are not absolutely safe.** Read [docs/security.md](docs/security.md) before you generate or import a secret.

## What it speaks

### Device models

| Brand | Models | Phone transport |
| --- | --- | --- |
| Ledger | Nano X, Flex, Stax, Nano Gen5 | BLE APDU |
| Trezor | Safe 7 | BLE THP |
| OneKey | Classic, Classic 1s, Pure, Touch, Pro (V1); Pro 2, Neo (V2) | BLE protobuf |

OneKey Mini has no BLE radio and is not simulated.

### Other transports

- **USB HID.** `CWS Proxy` on macOS (virtual HID) or `yarn proxy` on Linux (`uhid`) forwards reports to the phone over BLE. Chrome WebHID clients, including MetaMask, Rabby, Phantom, and Keplr, can use that gadget. The proxy does not filter APDUs. See Security.
- **Trezor Bridge.** The proxy can answer `http://127.0.0.1:21325` so Trezor-compatible hosts can enumerate a device. The bridge reflects the request `Origin`.
- **QR.** UR and BBQr exports for account keys, output descriptors, and, only after an on-device confirmation, a backup seed. Hosts that scan those codes include Rabby, MetaMask, Sparrow, BlueWallet, and OKX, depending on the format.

### Chains

Derivation and signing cover Bitcoin (legacy, nested SegWit, native SegWit, Taproot), Ethereum and EVM-style paths, Avalanche, Solana (Ledger and Phantom paths), Cosmos, Tron, XRP, Cardano, Polkadot, TON, Aptos, Sui, NEAR, Litecoin, Dogecoin, Stellar, Tezos, and BNB Beacon. A Ledger app catalog is included so a host can open an app name. Opening an app does not mean every host screen for that chain is finished.

Signing of a transaction or message, and export of a backup seed, wait for press-and-hold on the phone and, on a release build, for the OS authenticator. Listing addresses and exporting an extended public key stay silent, because the wallets above list accounts that way.

## Security, in one paragraph

The secret is stored with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and is not written to the clipboard. Release builds ask the OS authenticator before reveal, import, save, sign, and seed export. Android release builds set `FLAG_SECURE` on secret screens. That is not absolute safety. A connected host can derive addresses without a further prompt. WebHID and trezord are open to local clients on purpose. iOS cannot black a screenshot the way Android can. Details, including known host gaps, are in [docs/security.md](docs/security.md).

## Build and run

Requirements: Node.js, Yarn 1.22.22, a physical Android or iOS phone, and Xcode or Android Studio for the native build.

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
cd apps/mobile
npx expo prebuild
npx expo run:android   # or run:ios
```

BLE advertising does not work in a simulator or in Expo Go.

Desktop proxy:

```bash
yarn workspace @cws/native-proxy build   # once; needs Rust
yarn proxy                               # http://127.0.0.1:8788
```

On the phone, choose a model, select a seed, and start advertising. On the proxy page, press Start, then connect a wallet over the virtual USB device or use the testnet host tab. Linux HID needs `apps/proxy/udev/99-cws-uhid.rules`.

The signed macOS app is `apps/proxy/macos/CWSProxy` (`hk.ysk.cws.proxy`):

```bash
yarn workspace @cws/proxy app
```

That script uses the team already set in the Xcode project. To force a named certificate, set `CWS_CODESIGN_IDENTITY` and, if required, `CWS_PROFILE_SPECIFIER`. `apps/proxy/macos/pack.sh` is a separate packager; it requires `CWS_CODESIGN_IDENTITY` and `CWS_PROFILE`. Do not commit profiles or keystores.

A Play upload build reads `CWS_UPLOAD_STORE_FILE`, `CWS_UPLOAD_STORE_PASSWORD`, `CWS_UPLOAD_KEY_ALIAS`, and `CWS_UPLOAD_KEY_PASSWORD`. If the store file is unset, release packaging fails. No keystore is in this repository.

Product version **1.1.0** and build **6** come from `apps/mobile/app.json` (`version`, `versionCode`, `buildNumber`). Expo prebuild writes the Android `versionName` / `versionCode` and the iOS `CFBundleShortVersionString` / `CFBundleVersion`. Workspace packages that ship with the app are version `1.1.0`. The macOS proxy marketing version and build are the same numbers.

## Tests

```bash
yarn test
cd apps/proxy && yarn test:e2e
```

Maestro covers the phone UI and the proxy shell without BLE. Java must be on `PATH`. What was exercised on a handset, and what was not, is in [docs/testing.md](docs/testing.md).

## Licence and contributions

Copyright YSK Limited. All rights reserved. See [LICENSE](LICENSE). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md).

Engineering layout: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
