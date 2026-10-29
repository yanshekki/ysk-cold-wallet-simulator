# YSK Cold Wallet Simulator

**Version 1.1.0 (build 6)** · YSK Limited

Phone bundle `hk.ysk.cws` · CWS Proxy bundle `hk.ysk.cws.proxy`

A phone application for developers and wallet teams who need to test interoperability with selected Bluetooth hardware wallets.

The phone holds a BIP39 or SLIP-39 secret in operating-system secure storage and speaks the vendor protocol. A desktop proxy can present that phone as a USB HID device. Account data can also leave the phone as an animated or static QR code.

The phone app and the proxy UI include English, 繁體中文（香港）, Español, العربية, Português, Bahasa Indonesia, Français, 日本語, Русский, and Deutsch.

中文說明（香港書面語）：[docs/zh-HK.md](docs/zh-HK.md)

## Warning

CWS is a simulator. It is not a secure element. Ledger, Trezor, and OneKey do not endorse it. Do not use it to hold real digital assets.

**Seeds are not absolutely safe.** Read [docs/security.md](docs/security.md) before you generate or import a secret.

## Downloads

Version 1.1.0 (build 6). This repository does not publish installers. [GitHub Release v1.1.0](https://github.com/yanshekki/ysk-cold-wallet-simulator/releases/tag/v1.1.0) is notes only: no APK, IPA, or desktop package is attached.

| Product | Where to get it |
| --- | --- |
| Android phone | [Google Play](https://play.google.com/store/apps/details?id=hk.ysk.cws) (`hk.ysk.cws`) |
| iOS phone | App Store: Coming soon |
| CWS Proxy, macOS | Mac App Store: Coming soon. The HID Virtual Device App Store entitlement is still **Submitted**. |
| CWS Proxy, Linux | No packaged download. From source: `yarn proxy`, after the `uhid` rule in Quick start. |
| CWS Proxy, Windows | No packaged download. From source: `yarn proxy` after building `@cws/native-proxy`. Virtual HID is not implemented on Windows, so this does not create a USB HID device. The local page is `http://127.0.0.1:8788`. |

Virtual HID exists for Linux (`/dev/uhid`) and for the macOS CWS Proxy app. It is not implemented for Windows.

Until the Mac App Store build ships, build the macOS app from source with `yarn workspace @cws/proxy app`. That script uses the team already set in the Xcode project. Do not commit provisioning profiles.

## Quick start

Use a physical Android or iOS phone. A simulator and Expo Go cannot advertise Bluetooth.

1. Install the Android app from Google Play, or build the phone app from source.
2. Accept the warning, unlock, choose a model, and use a secret that does not control real assets.
3. Start advertising, then connect the third-party wallet over Bluetooth.
4. For desktop WebHID, start CWS Proxy (macOS app, or `yarn proxy` on Linux) and press Start. Chrome can then open the virtual USB device. The local page is `http://127.0.0.1:8788`.

From source you need Node.js, Yarn 1.22.22, and Xcode or Android Studio for the native phone build. The proxy’s HID library also needs Rust.

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
cd apps/mobile
npx expo prebuild
npx expo run:android   # or run:ios
```

Linux proxy, from the repository root:

```bash
yarn workspace @cws/native-proxy build   # once
yarn proxy                               # http://127.0.0.1:8788
```

Linux HID needs `apps/proxy/udev/99-cws-uhid.rules`. Copy it to `/etc/udev/rules.d/` and log in again. The rule sets group `plugdev` and mode `0660` on `/dev/uhid`.

On macOS, virtual HID is the signed CWS Proxy app, not `yarn proxy`:

```bash
yarn workspace @cws/proxy app
```

Product version **1.1.0** and build **6** come from `apps/mobile/app.json` (`version`, `versionCode`, `buildNumber`). Expo prebuild writes the Android `versionName` / `versionCode` and the iOS `CFBundleShortVersionString` / `CFBundleVersion`. Workspace packages that ship with the app are version `1.1.0`. The macOS proxy marketing version and build are the same numbers.

## What it speaks

### Device models

| Brand | Models | Phone transport |
| --- | --- | --- |
| Ledger | Nano X, Flex, Stax, Nano Gen5 | BLE APDU |
| Trezor | Safe 7 | BLE THP |
| OneKey | Classic, Classic 1s, Pure, Touch, Pro (V1); Pro 2, Neo (V2) | BLE protobuf |

OneKey Mini has no BLE radio and is not simulated.

### Other transports

| Transport | What this version does |
| --- | --- |
| USB HID | macOS CWS Proxy (virtual HID) or Linux `yarn proxy` (`uhid`) forwards reports to the phone over BLE. There is no APDU allowlist. A Chrome site you connect can send any command the phone implements. Phantom may still fail to finish unlock. |
| Trezor Bridge | The proxy can answer `http://127.0.0.1:21325` so a Trezor-compatible host can enumerate a device. The bridge reflects the request `Origin`. |
| QR | UR and BBQr for account keys and output descriptors. A backup-seed QR is produced only after on-device confirmation. |

Scan targets shown in the app, by format:

| Format | Where the app tells you to scan |
| --- | --- |
| Account UR (Keystone-style and the same family) | Rabby, MetaMask |
| Ethereum multi-account UR | OKX. Rabby and MetaMask reject this format. |
| Bitcoin account | Sparrow or BlueWallet, as a watch-only import |
| Bitcoin output descriptor | Sparrow |
| BBQr xpub | Sparrow, as a Coldcard QR import |
| Backup seed | On-device confirmation first. The code contains the secret. |

A named host can still fail to scan or to finish a screen. See known gaps in [docs/security.md](docs/security.md).

### Chains

Default paths live in `packages/contracts`. A host may request another path. Signing and address export exist for these chains. Opening a Ledger app name does not mean every screen in every host is finished.

| Chain | Default path |
| --- | --- |
| Bitcoin legacy | `m/44'/0'/0'/0/0` |
| Bitcoin nested SegWit | `m/49'/0'/0'/0/0` |
| Bitcoin native SegWit | `m/84'/0'/0'/0/0` |
| Bitcoin Taproot | `m/86'/0'/0'/0/0` |
| Ethereum and EVM-style paths | `m/44'/60'/0'/0/0` |
| Avalanche X/P | `m/44'/9000'/0'/0/0` |
| Solana (Ledger) | `m/44'/501'/0'` |
| Solana (Phantom) | `m/44'/501'/0'/0'` |
| Cosmos | `m/44'/118'/0'/0/0` |
| Tron | `m/44'/195'/0'/0/0` |
| XRP | `m/44'/144'/0'/0/0` |
| Cardano | `m/1852'/1815'/0'/0/0` |
| Polkadot | `m/44'/354'/0'/0'/0'` |
| TON | `m/44'/607'/0'/0'/0'/0'` |
| Aptos | `m/44'/637'/0'/0'/0'` |
| Sui | `m/44'/784'/0'/0'/0'` |
| NEAR | `m/44'/397'/0'/0'/1'` |
| Litecoin | `m/84'/2'/0'/0/0` |
| Dogecoin | `m/44'/3'/0'/0/0` |
| Stellar | `m/44'/148'/0'` |
| Tezos | `m/44'/1729'/0'` |
| BNB Beacon | `m/44'/714'/0'/0/0` |

Litecoin and Dogecoin use the Bitcoin handler. A bundled Ledger app catalog lets a host open an app name, including names that have no dedicated signing handler. Those names resolve as an unknown family.

A transaction signature, a message signature, and a backup-seed export wait for press-and-hold on the phone and, on a release build, for the OS authenticator. Listing addresses and exporting an extended public key stay silent, because the wallets above list accounts that way. While the phone is advertising, the Device screen says that a connected host can derive addresses.

## Security

The secret is stored with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and is not written to the clipboard. A release build asks the OS authenticator before reveal, import, save, sign, and seed export. Android release builds set `FLAG_SECURE` on secret screens.

That is not absolute safety. Four compatibility choices stay open in 1.1.0:

- WebHID forwards reports with no command allowlist.
- The local trezord bridge on `127.0.0.1` reflects the request `Origin`.
- Public-key and address listing stays silent, including an extended public key where the command carries a chain code.
- The stored entropy item does not use `requireAuthentication`, because a prompt on every read breaks account listing.

iOS can warn on a capture. It does not black the live image. Anyone who can unlock the phone, debug the process, photograph the screen, or connect a host can reach more than the UI shows. Details, platform limits, and known host gaps are in [docs/security.md](docs/security.md).

## Documentation

| Document | What it is |
| --- | --- |
| [docs/zh-HK.md](docs/zh-HK.md) | 香港書面語：同一版本、警告、下載與已知缺口 |
| [docs/security.md](docs/security.md) | Public security statement |
| [docs/testing.md](docs/testing.md) | What was tested, and what was not |
| [docs/releases/1.1.0.md](docs/releases/1.1.0.md) | Bilingual notes for 1.1.0 (build 6) |
| [docs/store/README.md](docs/store/README.md) | Mac App Store screenshot index |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Engineering layout |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Review, tests, and secrets to keep out of git |
| [LICENSE](LICENSE) | Copyright YSK Limited. All rights reserved. |

## Licence

Copyright © 2026 YSK Limited. All rights reserved.

The source is published so that behaviour and security limits can be read. No other licence is granted. The software is not fit for holding real digital assets. You may not present it as a product of Ledger, Trezor, OneKey, or any other wallet vendor. See [LICENSE](LICENSE).
