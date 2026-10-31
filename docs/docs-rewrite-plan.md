# Documentation rewrite plan

Status: proposal. This file is the only change in the planning pull request. Implementation waits for confirmation. The follow-up pull request should delete this file once the rewrite matches it.

Branch point: `b008f99e0e78edebf084d54015cb635d0ce93a4a` (`chore(release): bump CWS to 1.1.3 build 9`, same commit as `origin/main` on 31 Oct 2026). Tree version is **1.1.3 (build 9)**. The only git tag is `v1.1.0`.

Product page to cite: <https://ysk.hk/products/ysk-cold-wallet-simulator>

Publisher already used in the tree: **YSK Limited**. Site already used in the phone legal copy: **ysk.hk**. Do not invent trademarks, store listings, or security claims.

## What the rewrite is for

The public documents should read as one product, in professional technical English and in formal written Traditional Chinese, with a real MIT grant and a first-party macOS build guide for CWS Proxy. The phone app and the proxy UI already ship ten interface languages. Documents stay **English and 繁體中文（香港）** only.

Honesty that the rewrite must keep, in both languages:

- CWS is a simulator. It has no secure element. It is not a hardware wallet.
- Ledger, Trezor, and OneKey do not endorse it.
- Seeds are not absolutely safe. Seeds are not hardware-wallet safe.
- The hot-wallet baseline is progress toward Phantom, Rabby, and MetaMask mobile. It is not a secure element.
- Android is on Google Play (`hk.ysk.cws`). The iOS App Store listing and the CWS Proxy Mac App Store listing are coming soon. This repository does not publish those listings.
- GitHub Release `v1.1.0` attaches no APK, IPA, or desktop package. Later notes (1.1.1–1.1.3) also attach nothing. Do not invent asset URLs or tags.

The Chinese in user-facing documents should be formal written Traditional Chinese as already used in `docs/zh-HK.md` and the release notes. Do not label or footnote that style in any document. The phrase to remove is 「香港書面語」. The locale name **繁體中文（香港）** and the folder `zh-HK` stay; they name the product locale.

## Current inventory

Line counts are from the tree at the branch point. Screenshot files are assets, listed once.

| Path | Lines | Purpose | Quality |
| --- | ---: | --- | --- |
| `README.md` | 226 | English public front page: warning, downloads, quick start, Ubuntu `.deb`, one macOS command, protocols, security summary, testing narrative, doc index, licence | Does the job of five documents. Near-duplicate of `docs/zh-HK.md`. Labels the Chinese page 「香港書面語」 (lines 13 and 208). Licence section restates all-rights-reserved. No product URL. macOS build is `yarn workspace @cws/proxy app` and nothing else. |
| `docs/zh-HK.md` | 312 | Chinese parallel of the README, including the testing narrative | Same length problem. Doc index omits `ledger-apdu.md` and `vendor-protocols.md`, which the README lists. Licence section is 「保留所有權利」. No product URL. Does not label its own language. |
| `docs/security.md` | 73 | Public security statement for 1.1.3 (build 9) | The honesty document. English only. Header is 1.1.3; “Known host gaps” still says the gaps “are not finished in 1.1.0”. Chinese readers get a shorter retelling inside `docs/zh-HK.md`, which can drift. |
| `docs/testing.md` | 91 | What was run and what was not, plus three screenshots under `docs/testing/` | Header still says **Version 1.1.0 (build 6)** while the body includes the 31 Oct 2026 host-only KEEP note. English only. The same October sessions are retold in the README and in `docs/zh-HK.md`. |
| `docs/ARCHITECTURE.md` | 284 | Monorepo layout, BLE research tables, package map, limitations | Header says 1.1.3 (build 9). Footer says document version 1.1.0, date 2026-10-29. Protocol-package sections still read as an implementation todo (“Implement THP”). English only. Publisher line is YSK Limited, with no product URL. |
| `docs/ledger-apdu.md` | 453 | Ledger APDU wire matrix (`MATCH` / `FIXED` / `KEEP`) | Maintainer contract. Opening is a phase changelog. English only. Linked from the README. |
| `docs/vendor-protocols.md` | 65 | Trezor, OneKey, and QR wire notes, 30 Oct 2026 | Short and sourced. English only. |
| `docs/ledger-apdu-plan.md` | 285 | Catalog matrix and phase plan after merged PRs #49–#55 | Engineering backlog, not a product page. Absent from the README index. Linked from the wire docs. |
| `docs/full-vendor-parity-plan.md` | 444 | Backlog after that matrix. Tip cited in the file is `b421f7d`, older than `b008f99` | Same. Keep the status words. Do not present MATCH rows as a product guarantee. |
| `docs/releases/1.1.0.md` | 77 | Bilingual notes for 1.1.0 (build 6). States that public listing stayed silent | Historical. The Chinese section points at `docs/zh-HK.md` with the label 「香港書面語」. No product URL. |
| `docs/releases/1.1.1.md` | 57 | Bilingual notes for the hot-wallet baseline (build 7), including the phone confirm on public reads | Historical and more current than 1.1.0 on that point. Keep the difference. |
| `docs/releases/1.1.2.md` | 49 | Bilingual notes for build 8 | Same pattern as 1.1.1. |
| `docs/releases/1.1.3.md` | 45 | Bilingual notes for build 9: Bluetooth lock and vendor BLE UUIDs | Current note. macOS row is still “Coming soon” plus `yarn workspace @cws/proxy app`. |
| `docs/store/README.md` | 15 | Index of Mac App Store screenshot folders | Clear. Frozen at 1.1.0 (build 6). States that the Mac App Store build is still coming soon and that the HID Virtual Device App Store entitlement is still Submitted. |
| `docs/store/cws-proxy-macos/README.md` | 33 | Scene list for `en/` and `zh-HK/` frames | Useful. Says the zh-HK captions are 「香港書面語」. |
| `docs/store/cws-proxy-macos/{en,zh-HK}/*.png` | 28 files | Seven scenes, each at 2880×1800 and 1280×800, two locales | Assets for a submission that is not live. Leave the pixels alone. |
| `docs/testing/*.png` | 3 files | Empty Import, long-press, screenshot disclosure. No seed | Leave the pixels alone. |
| `CONTRIBUTING.md` | 30 | Review rules, tests, secrets that stay out of git | Useful and short. Tells contributors to write 「香港書面語」. Build steps point only at the README. |
| `LICENSE` | 9 | Copyright notice for the source | Custom all-rights-reserved text. See the licence section below. |

Also true of this tree, and relevant to the rewrite:

- There is no root `SECURITY.md`, no `NOTICE`, no `COPYING`, and no pull-request template.
- No `package.json` has a `license` field. `packages/native-proxy/Cargo.toml` has none. Every workspace package is `"private": true`.
- No source file carries an SPDX or copyright header.
- The phone clickwrap is a separate licence. `apps/mobile/src/i18n/locales/en.ts` (`disclaimer.licenceBody`) grants a personal, revocable, non-transferable licence and says all other rights are reserved. The same section exists in `ar.ts`, `de.ts`, `es.ts`, `fr.ts`, `id.ts`, `ja.ts`, `pt.ts`, `ru.ts`, and `zh-HK.ts`.
- The in-app site link is `https://ysk.hk` (`apps/mobile/app/(app)/settings/index.tsx`). The product path `https://ysk.hk/products/ysk-cold-wallet-simulator` does not appear anywhere in the repository.
- `.github/workflows/cws-proxy-deb.yml` builds the Ubuntu package. There is no macOS release workflow.

### Keep, merge, rename, delete

| Action | Paths | Why |
| --- | --- | --- |
| Rewrite in place | `README.md`, `docs/zh-HK.md`, `docs/security.md`, `docs/testing.md`, `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`, `LICENSE` | Public surface. Paths stay so existing links keep working. |
| Add | `docs/proxy-macos.md`, `docs/releases/README.md`, root `SECURITY.md` | The missing build guide, a release index, and a GitHub security pointer. |
| Light tidy | `docs/releases/1.1.0.md` … `1.1.3.md`, `docs/store/README.md`, `docs/store/cws-proxy-macos/README.md` | Company, product URL, remove the language label, point macOS builds at the new guide. Leave historical technical claims alone. |
| Keep, banner only | `docs/ledger-apdu.md`, `docs/vendor-protocols.md` | Maintainer contracts. Fix the changelog-shaped openings. Do not translate the matrices. |
| Keep, mark as backlog | `docs/ledger-apdu-plan.md`, `docs/full-vendor-parity-plan.md` | Still cited by the wire docs. One line at the top: engineering backlog, not a product guarantee. Leave them out of the public README index. |
| Leave unchanged | Screenshot PNGs, `docs/testing/*.png` | Not prose. Regenerating store frames is out of scope. They remain 1.1.0 (build 6) frames. |
| Delete in the implementation PR | `docs/docs-rewrite-plan.md` | This proposal should not remain as another stale doc. |
| Do not add | `NOTICE`, per-file copyright headers, a Chinese `LICENSE`, any third locale, `docs/zh-CN/` | See non-goals and the MIT checklist. |

`README.md` and `docs/zh-HK.md` stay two files. Release notes, `docs/security.md`, `docs/testing.md`, and the new proxy guide use one file with an English section and a **繁體中文（香港）** section. That is the pattern the release notes already use. Protocol matrices stay English.

## Target doc tree

```
LICENSE
SECURITY.md                         # new: reports go to a GitHub issue; statement is docs/security.md
README.md                           # short English product page
CONTRIBUTING.md
docs/zh-HK.md                       # short Chinese product page, same outline as the README
docs/proxy-macos.md                 # new bilingual macOS build guide
docs/security.md                    # English, then 繁體中文（香港）
docs/testing.md                     # English, then 繁體中文（香港）
docs/ARCHITECTURE.md                # English engineering layout, brought up to 1.1.3
docs/ledger-apdu.md
docs/vendor-protocols.md
docs/ledger-apdu-plan.md            # backlog
docs/full-vendor-parity-plan.md     # backlog
docs/releases/README.md             # new bilingual index
docs/releases/1.1.0.md
docs/releases/1.1.1.md
docs/releases/1.1.2.md
docs/releases/1.1.3.md
docs/store/README.md
docs/store/cws-proxy-macos/README.md
docs/store/cws-proxy-macos/en/*.png
docs/store/cws-proxy-macos/zh-HK/*.png
docs/testing/*.png
```

### How the long pages split

`README.md` and `docs/zh-HK.md` become the product pages:

1. Name, version 1.1.3 (build 9), YSK Limited, product URL, bundle ids.
2. One-paragraph description and the language list already in the README (the ten UI languages).
3. Warning: simulator, no secure element, not endorsed, seeds are not absolutely safe, link to `docs/security.md`.
4. Downloads table. Android: Google Play. iOS: App Store coming soon. CWS Proxy macOS: Mac App Store coming soon, with a link to `docs/proxy-macos.md` for a local build. Ubuntu: keep the package name and the build command, with the existing detail tightened rather than moved. Other Linux and Windows: the current facts (`yarn proxy`, no virtual HID on Windows, local page `http://127.0.0.1:8788`).
5. Short “what it speaks” tables, or a pointer to `docs/ARCHITECTURE.md` plus the two wire docs. The chain-path table can stay; it is product fact.
6. Documentation index that matches the target tree. The README index today lists protocol docs; `docs/zh-HK.md` does not. Both indexes should match.
7. Licence: MIT, link to `LICENSE`, copyright YSK Limited, and the product warnings beside the grant (wording in the MIT section).

Move out of both product pages:

- The step-by-step macOS build, into `docs/proxy-macos.md`.
- The October 2026 host narratives, into `docs/testing.md`. Each product page keeps two or three sentences and a link.
- The full security model, which already lives in `docs/security.md`. Each product page keeps the warning and the open compatibility choices in short form.

Ubuntu stays summarised on the product pages because that procedure is already the public install path and this plan does not add a second Linux guide. The macOS page is new because the product pages only contain this:

```bash
yarn workspace @cws/proxy app
```

### `docs/security.md` and `docs/testing.md`

Rewrite for structure and for the bilingual section. Preserve the claims:

- Keychain `requireAuthentication` on a release build, clipboard behaviour, Android `FLAG_SECURE`, iOS warn-only capture, public-read confirm (one confirm, next 15 reads, 60 seconds, not a signature), iOS BLE link key absent, proxy stores no seed.
- WebHID has no allowlist. trezord on `127.0.0.1` reflects `Origin`. Those stay open on purpose.
- Known host gaps stay gaps: Phantom unlock, Rabby camera scan, Avalanche Core X/P listing, OKX balances. Ledger Live genuine check is not expected to pass.
- Testing header should say the record covers the 1.1.0 handset pass and later notes through the 1.1.3 tree, and that a green suite is not a statement that a seed is safe.

The 1.1.0 release note says address and extended-public-key listing stayed silent. `docs/releases/1.1.1.md` says the phone confirms those reads. Both sentences are historically right. The rewrite must not “correct” 1.1.0 into the 1.1.1 policy, and must not revive the silent-listing sentence on the 1.1.3 product page.

### `docs/ARCHITECTURE.md`

Make it a current map:

- Publisher YSK Limited and the product URL.
- The tree in section 2, which already matches `apps/mobile`, `apps/proxy`, and `packages/*`.
- Replace package sections that still say “implement” with what the code does, and point wire detail at `docs/ledger-apdu.md` and `docs/vendor-protocols.md`.
- Limitations stay aligned with `docs/security.md`, including the proxy Bluetooth lock.
- Footer version 1.1.3 (build 9). Drop the 1.1.0 document-version line.

English only. `docs/zh-HK.md` links to it.

### Release notes and store docs

Add `docs/releases/README.md` with the four notes, the statement that `v1.1.0` is the only tag and attaches no binaries, YSK Limited, and the product URL.

On each existing note: add the product URL once, point the macOS row at `docs/proxy-macos.md`, and remove the language label from `docs/releases/1.1.0.md`. Leave the technical bullets.

Store docs: say the frames are the 1.1.0 (build 6) submission set, the Mac App Store build is still coming soon, and the HID Virtual Device App Store entitlement is still Submitted. Describe the zh-HK captions as Traditional Chinese for that locale. Do not call them 「香港書面語」.

### `CONTRIBUTING.md` and `SECURITY.md`

`CONTRIBUTING.md` keeps the current rules (tests, no secrets in git, no personal certificate common name, do not claim a change makes seeds absolutely safe). The Hong Kong Chinese instruction should name the file `apps/mobile/src/i18n/locales/zh-HK.ts` and require formal written Traditional Chinese, not a transcription of speech, and not Simplified Chinese, without the label 「香港書面語」. Point proxy builds at `docs/proxy-macos.md`.

`SECURITY.md` is a short English pointer: open a GitHub issue on this repository, do not include a live seed, and read `docs/security.md`. No new disclosure address. The project already says it does not publish one.

### Phrases to remove

| File | Current wording |
| --- | --- |
| `README.md` | 「香港書面語」 on the Chinese link and in the doc table |
| `docs/store/cws-proxy-macos/README.md` | “The caption on each frame is 香港書面語 only.” |
| `docs/releases/1.1.0.md` | 「香港書面語全文見」 |
| `CONTRIBUTING.md` | “Write 香港書面語” |

## MIT migration

### What the licence is today

`LICENSE` is not a recognised open-source licence. Full text:

> Copyright (c) 2026 YSK Limited. All rights reserved.
>
> The source of YSK Cold Wallet Simulator is published so that its behaviour and security limits can be read. No other licence is granted.
>
> You may clone this repository and propose changes. You may not present the software as an official product of Ledger, Trezor, OneKey, or any other wallet vendor. You may not remove or contradict the statement that seeds are not absolutely safe.
>
> The software is provided as is, without warranty of any kind. It is not fit for holding real digital assets. YSK Limited accepts no liability for loss of secrets or assets arising from use of this software.
>
> If you need a different licence, ask YSK Limited. Silence is not a grant.

`README.md` and `docs/zh-HK.md` repeat “all rights reserved” and “no other licence is granted”.

### Target `LICENSE` text

Replace the file with the standard MIT licence. Copyright holder **YSK Limited**, year **2026**. No extra conditions inside the file. A rider would mean the grant is no longer MIT.

```
MIT License

Copyright (c) 2026 YSK Limited

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Product limits stay in the README, `docs/zh-HK.md`, and `docs/security.md`. They are statements about the product. They are not additional licence conditions. Suggested English snippet under a `## Licence` heading, plus a badge next to the title pointing at `LICENSE`:

```markdown
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
```

```markdown
## Licence

[MIT](LICENSE). Copyright © 2026 YSK Limited.

MIT does not make CWS a secure element, and it does not make this software a product of Ledger, Trezor, or OneKey. Seeds are not absolutely safe. Read [docs/security.md](docs/security.md).
```

The Chinese product page explains that the repository is MIT, links to the English `LICENSE`, and keeps the same product warnings. It should say the English file is the grant. Do not add a homemade Chinese MIT as `LICENSE` or as a second licence file.

### Files to update

| File | Change |
| --- | --- |
| `LICENSE` | Replace with the MIT text above. |
| `README.md`, `docs/zh-HK.md` | Badge or equivalent on the English page. Replace the all-rights-reserved section. |
| `package.json` | Add `"license": "MIT"`. Leave `"private": true`. |
| `apps/mobile/package.json` | Same. |
| `apps/proxy/package.json` | Same. |
| `packages/contracts/package.json` | Same. |
| `packages/sdk/package.json` | Same. |
| `packages/ui/package.json` | Same. |
| `packages/protocol-ledger/package.json` | Same. |
| `packages/protocol-trezor/package.json` | Same. |
| `packages/protocol-onekey/package.json` | Same. |
| `packages/protocol-qr/package.json` | Same. |
| `packages/native-proxy/package.json` | Same. |
| `packages/native-proxy/Cargo.toml` | Add `license = "MIT"`. Leave `publish = false`. |

No other tracked file contains `license` or a copyright header. Do not add a header to every source file in the docs pull request.

### Wording risks

1. The sentences “No other licence is granted” and “Silence is not a grant” go away because they contradict MIT. That is the change.
2. “You may not remove the seeds statement” cannot remain a licence condition. The statement stays in `docs/security.md` and the product pages. MIT allows people to copy the code; it does not require this repository’s security page to be weakened.
3. “You may not present the software as an official product of Ledger, Trezor, or OneKey” is already true as a trademark matter: MIT does not grant those marks. Keep the non-endorsement sentence on the product pages. Do not write it into `LICENSE`.
4. MIT’s warranty disclaimer is shorter than the phone clickwrap, which carves out liability Hong Kong law does not allow to be excluded. Replacing `LICENSE` does not replace that clickwrap.
5. **Clickwrap conflict, left for a separate decision.** The app text in ten locale files still says the licence is personal, revocable, and non-transferable, and that all other rights are reserved (`disclaimer.licenceBody` in `apps/mobile/src/i18n/locales/en.ts` and the matching key in the other nine files). The docs pull request does not change UI copy. Shipping MIT in the repository while the app still says that is a real inconsistency. Shek should decide later whether the clickwrap’s licence paragraph is amended to point at MIT, or kept as a store-distributed-app contract. This plan does not choose that amendment.
6. `packages/sdk/src/slip39Wordlist.ts` is the SLIP-39 English word list with no copyright header and no separate licence file. There is no other vendored `LICENSE` or `NOTICE` in the tree. npm and Cargo dependencies keep their own licences. Setting this repository to MIT does not relicense those dependencies. Do not add a YSK copyright header on the word list.

### Third-party files that stay distinct

None are checked in. Do not create a `NOTICE` that claims MIT over `node_modules` or crates. Do not copy dependency licence files into the repo as part of this rewrite.

## CWS Proxy macOS build guide

New file: `docs/proxy-macos.md`. One English section, then one **繁體中文（香港）** section, same facts.

### Facts the guide must follow

The command the product pages already give is the real entry point.

| Piece | Where it actually is |
| --- | --- |
| Yarn script | Root `package.json` workspaces are `apps/*` and `packages/*`. `apps/proxy/package.json` script `app` is `bash macos/xcode-app.sh`. From the repo root: `yarn workspace @cws/proxy app`. |
| Xcode driver | `apps/proxy/macos/xcode-app.sh`. It `cd`s to `apps/proxy`, sets `DEVELOPER_DIR` to `/Applications/Xcode.app/Contents/Developer` unless already set, and runs `xcodebuild`. |
| Project and scheme | `-project macos/CWSProxy/CWSProxy.xcodeproj`, `-scheme "CWS Proxy"`. Shared scheme: `apps/proxy/macos/CWSProxy/CWSProxy.xcodeproj/xcshareddata/xcschemes/CWS Proxy.xcscheme`. |
| Configuration | The script forces **Debug**, `ARCHS=arm64`, `ONLY_ACTIVE_ARCH=YES`, destination `generic/platform=macOS`. The scheme’s Archive action is Release. No yarn script archives or notarizes. |
| Derived data | `-derivedDataPath macos/CWSProxy/DerivedData`, relative to `apps/proxy`. |
| Built app | `apps/proxy/macos/CWSProxy/DerivedData/Build/Products/Debug/CWS Proxy.app` |
| Gitignore | `apps/proxy/macos/CWSProxy/DerivedData/` and `**/DerivedData/` in `.gitignore`. A clean removes the built app. |
| Bundle phase | Xcode run script is `"$SRCROOT/bundle-proxy.sh"`. `SRCROOT` is `apps/proxy/macos/CWSProxy`. The script file is `apps/proxy/macos/CWSProxy/bundle-proxy.sh`. |
| What the bundle phase does | Copies the `node` binary from `PATH` into the app, bundles `apps/proxy/src/main.ts` with the repo’s `esbuild` to `proxy/main.cjs`, copies `packages/native-proxy` (`index.js`, `package.json`, and every `*.node`), copies `apps/proxy/ui/*`, and codesigns the Node binary and the addon when Xcode provides an identity. |
| Native addon | `yarn workspace @cws/native-proxy build`, which is `napi build --platform --release --js false` in `packages/native-proxy`. `bundle-proxy.sh` exits if no `*.node` is present. |
| Signing in the project | `CODE_SIGN_STYLE = Automatic`, `DEVELOPMENT_TEAM = K897VVZW77`, hardened runtime, marketing version 1.1.3, build 9, deployment target macOS 13.0. Entitlements: `apps/proxy/macos/CWSProxy/CWSProxy/CWSProxy.entitlements`, including `com.apple.developer.hid.virtual.device`. Optional override: `CWS_CODESIGN_IDENTITY` in `xcode-app.sh`. |
| Bundle id and name | `hk.ysk.cws.proxy`, display name CWS Proxy. `Info.plist`: `apps/proxy/macos/CWSProxy/CWSProxy/Info.plist`. |
| UI port | Fixed in the app. `ProxySession.uiPort` in `apps/proxy/macos/CWSProxy/CWSProxy/ProxySession.swift` is **8788**. `NodeProcess.swift` starts the bundled proxy with `--ui-port` set to that port and `CWS_NO_OPEN=1`. `ContentView.swift` loads `http://127.0.0.1:8788/?native=1` in a WebKit view inside the window. |
| CLI port flag | `apps/proxy/src/main.ts` documents `cws-proxy --ui-port 8788` and `yarn proxy`. The same file says macOS HID is the signed CWS Proxy app, and that `yarn proxy` is not that app. |
| Bluetooth lock | `~/Library/Application Support/CWS Proxy/ble-lock.json`. Permission: System Settings → Privacy & Security → Bluetooth. |
| Install location | **No script copies the app to `/Applications`.** `xcode-app.sh` only mentions `/Applications` as the default Xcode path. After a successful build, run it in place with `open`, or copy the `.app` bundle to `/Applications` yourself. Copying is what makes it survive a DerivedData clean. |
| Other packager | `apps/proxy/macos/pack.sh` writes `apps/proxy/dist/CWS Proxy.app` and requires `CWS_CODESIGN_IDENTITY` and `CWS_PROFILE`. `CONTRIBUTING.md` already calls it a separate packager. It is not what `yarn workspace @cws/proxy app` runs. The guide names it so readers do not follow it as the primary path. |
| Store | Mac App Store: coming soon. Entitlement still Submitted, as `README.md` and `docs/store/README.md` already say. The guide does not publish a store URL. |

A Debug product already exists on a machine that has run this script, at the DerivedData path above. The planning pull request did not rebuild it.

### Outline of `docs/proxy-macos.md`

1. **What this builds.** A local Debug `CWS Proxy.app` for Apple silicon. Virtual HID on macOS is this app. `yarn proxy` does not create that HID device.
2. **Not on the Mac App Store.** Coming soon. The HID Virtual Device App Store entitlement is still Submitted. This page is the from-source path until a store listing exists. No installer URL.
3. **Prerequisites.**
   - Apple silicon Mac. The script sets `ARCHS=arm64`.
   - macOS deployment target in the project is 13.0.
   - Full Xcode at `/Applications/Xcode.app`, or `DEVELOPER_DIR` pointing at another Xcode. Command Line Tools alone do not satisfy the script’s default.
   - Node on `PATH`. The bundle phase copies that binary into the app. The Ubuntu package pins Node.js 24.22.2; this macOS script does not. The Ubuntu section of the README already asks for Node.js 22 or newer for a from-source proxy. Use that floor here, and say the script embeds whichever `node` it finds.
   - `python3` (`bundle-proxy.sh` uses it for `realpath`).
   - Yarn 1.22.22 (`packageManager` in the root `package.json`), via corepack.
   - Rust and Cargo, because `@cws/native-proxy` builds with `@napi-rs/cli`. There is no `rust-toolchain` file.
   - Apple signing for the team in the Xcode project (`K897VVZW77`) when building the committed project. A fork replaces that team (`CONTRIBUTING.md`). Do not commit profiles, certificates, or passwords. Virtual HID asks for `com.apple.developer.hid.virtual.device`. If signing fails, say so; do not offer `yarn proxy` as a macOS HID substitute.
4. **Commands,** from the repository root, in this order:

   ```bash
   corepack enable && corepack prepare yarn@1.22.22 --activate
   yarn
   yarn workspace @cws/native-proxy build
   yarn workspace @cws/proxy app
   open "apps/proxy/macos/CWSProxy/DerivedData/Build/Products/Debug/CWS Proxy.app"
   ```

   `yarn workspace @cws/proxy app` is `bash macos/xcode-app.sh`. Equivalent direct call: `bash apps/proxy/macos/xcode-app.sh`.
5. **Where the app is.** The Debug path above. It is gitignored.
6. **`/Applications`.** Optional copy, performed by the reader, not by the script:

   ```bash
   cp -R "apps/proxy/macos/CWSProxy/DerivedData/Build/Products/Debug/CWS Proxy.app" /Applications/
   ```

   Then open `/Applications/CWS Proxy.app`. System Settings → Privacy & Security → Bluetooth must allow that copy.
7. **How it runs.** The window is the proxy page. Port **8788** is fixed in Swift. A browser on the same machine can open `http://127.0.0.1:8788`. The `--ui-port` flag belongs to `cws-proxy` / `yarn proxy`, which is the Linux and Windows daemon. Changing that flag does not retarget the macOS app.
8. **First session.** Start, pick the phone, lock file path, proxy forwards bytes, signing stays on the phone, seeds are not in the lock file. Same facts as the 1.1.3 note.
9. **What this build is not.** Not a Mac App Store archive, not a notarized Release upload, not an Ubuntu `.deb` (`bash apps/proxy/linux/build-deb.sh` and `yarn workspace @cws/proxy deb`), and not `apps/proxy/macos/pack.sh`.
10. **Related pages.** `docs/security.md`, `docs/store/cws-proxy-macos/README.md`, `docs/releases/1.1.3.md`.

Scripts and docs the guide should cite by path: `apps/proxy/macos/xcode-app.sh`, `apps/proxy/macos/CWSProxy/bundle-proxy.sh`, `apps/proxy/macos/pack.sh` (as the other packager), `apps/proxy/src/main.ts`, `packages/native-proxy/package.json`, `apps/proxy/linux/build-deb.sh` (one sentence, so Linux readers are not sent through the macOS page), `docs/security.md`, `docs/store/README.md`.

## Where the company and the product URL go

Use the name **YSK Limited** and the URL <https://ysk.hk/products/ysk-cold-wallet-simulator>. The bare host `https://ysk.hk` stays acceptable inside the existing privacy-enquiry sentences if those sentences are only being moved, not rewritten into a new claim.

| Place | What appears |
| --- | --- |
| `README.md` | Title block: YSK Limited, product URL. Licence: copyright YSK Limited. |
| `docs/zh-HK.md` | Same, in Chinese. Company name stays “YSK Limited”. |
| `docs/security.md` | Publisher line and product URL next to the version. Both language sections. |
| `docs/ARCHITECTURE.md` | Publisher line gains the product URL. |
| `docs/releases/README.md` | Index header. |
| `docs/releases/1.1.*.md` | One line under the existing “YSK Limited · phone · proxy” header. Historical bullets stay. |
| `docs/proxy-macos.md` | Opening: who publishes the app, product URL, Mac App Store still coming soon. |
| `docs/store/README.md` | Publisher and product URL, still a screenshot index for a listing that is not live. |
| `CONTRIBUTING.md` | Publisher named once. No marketing block. |
| `LICENSE` | Copyright (c) 2026 YSK Limited. The product URL stays out of the MIT text. |

Do not change `YSK_SITE` in the phone settings screen. That is UI.

## Pull request split

**One implementation pull request** after this plan is confirmed. Title along the lines of `docs: professional rewrite, MIT, and CWS Proxy macOS guide`.

Put `LICENSE`, the `license` fields, and the doc edits in that same pull request. Splitting the licence from the pages would leave a window where `LICENSE` says MIT and the README still says all rights reserved, or the reverse. The clickwrap inconsistency is called out in the pull request body and is not “fixed” by editing locale files there.

Do not open the implementation pull request from this planning run.

## Non-goals

- Do not rewrite application UI copy, including the ten locale files under `apps/mobile/src/i18n/locales/` and the proxy page strings, unless a later decision changes the clickwrap. Quoting a string from a doc is not a reason to edit the app.
- Do not publish CWS Proxy to the Mac App Store, submit the HID entitlement, notarize a Release archive, or add a macOS release workflow.
- Do not add an iOS App Store listing, a new git tag, or GitHub Release assets.
- Do not change protocol behaviour, security controls, or tests, except the `license` metadata fields.
- Do not add a third documentation locale, a Simplified Chinese edition, or translations of `docs/ledger-apdu.md` and `docs/vendor-protocols.md`.
- Do not regenerate store screenshots or testing screenshots.
- Do not delete the engineering backlog (`docs/ledger-apdu-plan.md`, `docs/full-vendor-parity-plan.md`).
- Do not rewrite historical release notes so that 1.1.0 matches 1.1.3.
- Do not put product warnings inside the MIT file, and do not leave the old “no other licence” sentences beside MIT.
- Do not claim a secure element, hardware-wallet seed safety, or vendor endorsement.
- Do not commit provisioning profiles, certificates, `DerivedData/`, or `apps/proxy/dist/`.

## Acceptance criteria for the implementation pull request

1. `LICENSE` is the MIT text in this plan, copyright YSK Limited, 2026, with no extra grant conditions.
2. Root `package.json`, every workspace `package.json`, and `packages/native-proxy/Cargo.toml` set the licence to MIT. `"private": true` and `publish = false` stay.
3. `README.md` and `docs/zh-HK.md` are the short product pages. Both link to <https://ysk.hk/products/ysk-cold-wallet-simulator>, name YSK Limited, link the MIT file, and keep the simulator / no-endorsement / seeds warnings.
4. The English README shows an MIT badge or a plain MIT link that resolves to `LICENSE`.
5. `docs/proxy-macos.md` exists in English and 繁體中文（香港）, uses the commands and paths in this plan, says the app is not on the Mac App Store, says the script builds a Debug app under DerivedData, and says copying to `/Applications` is manual.
6. The guide states that `yarn proxy` is not macOS virtual HID, and that `apps/proxy/macos/pack.sh` is the other packager.
7. `docs/security.md` and `docs/testing.md` each have both language sections. Claims listed in this plan are still present. The testing header no longer says the whole record is only 1.1.0.
8. `docs/releases/README.md` exists. The four notes still exist. 1.1.0 still records silent public listing. 1.1.1 still records the phone confirm.
9. `docs/ARCHITECTURE.md` footer matches 1.1.3 (build 9) and no longer tells the reader to implement THP from scratch.
10. No tracked document contains 「香港書面語」.
11. No application source file under `apps/mobile/src/i18n/` changes.
12. Screenshot binaries do not change.
13. Internal links in the rewritten pages resolve. The documentation indexes in `README.md` and `docs/zh-HK.md` list the same targets.
14. `docs/docs-rewrite-plan.md` is removed in that pull request.
15. The pull request description states that the in-app clickwrap still reserves all other rights, and that this was left unchanged on purpose.

## Implementation order inside that pull request

1. `LICENSE` and the `license` metadata fields.
2. `docs/proxy-macos.md`, so the product pages can link to it.
3. `README.md` and `docs/zh-HK.md`.
4. `docs/security.md`, `docs/testing.md`, `SECURITY.md`.
5. `docs/releases/README.md` and the light pass on the four notes.
6. `docs/ARCHITECTURE.md`, store READMEs, `CONTRIBUTING.md`.
7. One-line banners on the two wire docs and the two backlog docs.
8. Delete this plan file.
9. Search the tree for 「香港書面語」, “All rights reserved”, and “No other licence” and confirm the only remaining hits, if any, are the untouched clickwrap locale files.
