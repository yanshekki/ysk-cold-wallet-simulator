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

Version 1.1.0 (build 6). [GitHub Release v1.1.0](https://github.com/yanshekki/ysk-cold-wallet-simulator/releases/tag/v1.1.0) is notes only: no APK, IPA, or desktop package is attached. Ubuntu can build a `.deb` from this tree. macOS and Windows still have no installable package on that release.

| Product | Where to get it |
| --- | --- |
| Android phone | [Google Play](https://play.google.com/store/apps/details?id=hk.ysk.cws) (`hk.ysk.cws`) |
| iOS phone | App Store: Coming soon |
| CWS Proxy, macOS | Mac App Store: Coming soon. The HID Virtual Device App Store entitlement is still **Submitted**. |
| CWS Proxy, Ubuntu | Package `hk.ysk.cws.proxy` (amd64 and arm64). Build it on Ubuntu with `bash apps/proxy/linux/build-deb.sh`, then install the `.deb`. It installs `cws-proxy` and the `uhid` udev rule. The GitHub Release does not attach the `.deb`. See [Ubuntu package](#ubuntu-package). |
| CWS Proxy, other Linux | No package. From source: `yarn proxy`, after the `uhid` rule in Quick start. |
| CWS Proxy, Windows | No packaged download. From source: `yarn proxy` after building `@cws/native-proxy`. Virtual HID is not implemented on Windows, so this does not create a USB HID device. The local page is `http://127.0.0.1:8788`. |

Virtual HID exists for Linux (`/dev/uhid`, including the Ubuntu package) and for the macOS CWS Proxy app. It is not implemented for Windows.

Until the Mac App Store build ships, build the macOS app from source with `yarn workspace @cws/proxy app`. That script uses the team already set in the Xcode project. Do not commit provisioning profiles.

## Quick start

Use a physical Android or iOS phone. A simulator and Expo Go cannot advertise Bluetooth.

1. Install the Android app from Google Play, or build the phone app from source.
2. Accept the warning, unlock, choose a model, and use a secret that does not control real assets.
3. Start advertising, then connect the third-party wallet over Bluetooth.
4. For desktop WebHID, start CWS Proxy (macOS app, Ubuntu `cws-proxy` from the `.deb`, or `yarn proxy` on Linux) and press Start. Chrome can then open the virtual USB device. The local page is `http://127.0.0.1:8788`.

From source you need Node.js, Yarn 1.22.22, and Xcode or Android Studio for the native phone build. The proxy’s HID library also needs Rust.

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
cd apps/mobile
npx expo prebuild
npx expo run:android   # or run:ios
```

Linux proxy from source, from the repository root:

```bash
yarn workspace @cws/native-proxy build   # once
yarn proxy                               # http://127.0.0.1:8788
```

That path does not install a package. Copy `apps/proxy/udev/99-cws-uhid.rules` to `/etc/udev/rules.d/` and log in again. The rule sets group `plugdev` and mode `0660` on `/dev/uhid`. Ubuntu can install the same rule with the package below.

### Ubuntu package

The package name is `hk.ysk.cws.proxy`. It is a `.deb` for Ubuntu amd64 and arm64 (glibc 2.34 or newer: Ubuntu 22.04 and 24.04). It installs:

- `/usr/bin/cws-proxy`
- a private Node.js 24 runtime and the proxy program under `/usr/lib/hk.ysk.cws.proxy`
- `/usr/lib/udev/rules.d/99-cws-uhid.rules`, byte-for-byte the same file as `apps/proxy/udev/99-cws-uhid.rules`

`postinst` creates the `plugdev` group if it is missing, writes `/etc/modules-load.d/cws-proxy.conf` so the kernel loads `uhid`, and runs `udevadm control --reload-rules`. `/dev/uhid` is group `plugdev`, mode `0660`. If your account is not in `plugdev`, add it and log in again before virtual HID works.

GitHub Release v1.1.0 does not attach this `.deb`. Build it on Ubuntu. [`.github/workflows/cws-proxy-deb.yml`](.github/workflows/cws-proxy-deb.yml) builds amd64 (`ubuntu-24.04`) and arm64 (`ubuntu-24.04-arm`) and uploads each `.deb` as a workflow artifact. That artifact is not a GitHub Release asset.

```bash
sudo apt-get install -y build-essential pkg-config libdbus-1-dev curl ca-certificates python3 xz-utils
# Node.js 22 or newer, Yarn 1.22.22, and Rust (rustup)
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
yarn workspace @cws/native-proxy build
bash apps/proxy/linux/build-deb.sh
bash apps/proxy/linux/check-deb.sh apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
sudo apt-get install -y ./apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
sudo usermod -aG plugdev "$USER"   # then log in again
cws-proxy                          # http://127.0.0.1:8788
```

On arm64 Ubuntu the script selects arm64 from `uname -m`. Pass `--arch amd64` or `--arch arm64` to override. `yarn workspace @cws/proxy deb` is the same build script.

Check the archive without installing:

```bash
dpkg-deb -I apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
dpkg-deb -c apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
bash apps/proxy/linux/check-deb.sh apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
```

After install, `cws-proxy --help` should print usage, and `/usr/lib/udev/rules.d/99-cws-uhid.rules` should match the source rule. Opening `/dev/uhid` still needs membership in `plugdev` and a new login. A full HID session also needs the phone advertising over Bluetooth. Checking the archive does not by itself prove that a desktop login can open `/dev/uhid`.

`bash apps/proxy/linux/check-deb.sh` with no arguments builds a layout-check `.deb` whose Node binary and native addon are ELF stubs. Use that only to inspect the archive on a machine that cannot compile the Linux addon. Do not install it.

The package does not contain a seed, a keystore, or a provisioning profile. Seeds are not absolutely safe.

Windows still has no package. Virtual HID is not implemented on Windows.

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
| USB HID | macOS CWS Proxy (virtual HID), or Linux `cws-proxy` from the Ubuntu package or `yarn proxy` (`uhid`), forwards reports to the phone over BLE. There is no APDU allowlist. A Chrome site you connect can send any command the phone implements. Phantom may still fail to finish unlock. |
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

Settings → Ledger catalog can pick a published version for each app. That is the version a host reads from the open app. It does not switch CWS to that older app’s commands. Update Ledger apps reloads names and versions from Ledger’s public catalog for the selected device. Until then, the list is the bundled catalog for that device.

A transaction signature, a message signature, and a backup-seed export wait for press-and-hold on the phone and, on a release build, for the OS authenticator. Listing addresses and exporting an extended public key stay silent, because the wallets above list accounts that way. While the phone is advertising, the Device screen says that a connected host can derive addresses.

## Security

The secret is stored with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and is not written to the clipboard. A release build asks the OS authenticator before reveal, import, save, sign, and seed export. Android release builds set `FLAG_SECURE` on secret screens.

That is not absolute safety. Four compatibility choices stay open in 1.1.0:

- WebHID forwards reports with no command allowlist.
- The local trezord bridge on `127.0.0.1` reflects the request `Origin`.
- Public-key and address listing stays silent, including an extended public key where the command carries a chain code.
- The stored entropy item does not use `requireAuthentication`, because a prompt on every read breaks account listing.

iOS can warn on a capture. It does not black the live image. Anyone who can unlock the phone, debug the process, photograph the screen, or connect a host can reach more than the UI shows. Details, platform limits, and known host gaps are in [docs/security.md](docs/security.md).

## Testing

What was run, and what was not, is in [docs/testing.md](docs/testing.md). In October 2026 a person reported three sessions. An iPhone running 1.1.0 (build 6) advertised as Ledger over Bluetooth, and near.com finished login and one transaction. Core (core.app) used a Ledger identity on CWS through CWS Proxy and finished an Avalanche export/import round-trip: C-Chain → X-Chain → P-Chain → X-Chain → C-Chain. Rabby Wallet (the extension) used that same CWS Proxy path after tip 0fbbf4c (#43) and finished one trade on lfj.gg (Trader Joe / LFJ). Each note is that host on that path. The Core note leaves the separate X/P account-listing gap in place. The Rabby note is that one lfj.gg trade and leaves the Rabby camera-scan gap in place. Seeds are not absolutely safe.

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
