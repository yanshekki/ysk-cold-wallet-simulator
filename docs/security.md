# Security

**Version 1.1.3 (build 9).** This is the public statement of what CWS protects and what it leaves open. Seeds are not hardware-wallet safe.

**Seeds are not absolutely safe.** CWS has no secure element. Do not put a seed that controls real digital assets on the device.

Read this before you generate or import a secret. The short version is on the [README](../README.md). 中文要點在 [zh-HK.md](zh-HK.md).

## Hot-wallet baseline

This is progress toward Phantom, Rabby, and MetaMask mobile. It is not a secure element. Seeds are not hardware-wallet safe.

| Item | Result | Residual |
| --- | --- | --- |
| Keychain `requireAuthentication` on entropy and shares in a release build | Pass | The skip exists only when `__DEV__` is true. Release always sets the flag. The first successful read is cached in memory until lock. Reveal and backup force a fresh authenticator read. An item saved before this flag is rewritten on the next read |
| No mnemonic or private key on the clipboard. System copy is off. Seed QR and backup wait for a confirm sheet | Pass | Import does not read the clipboard until Paste is confirmed. A successful import clears the clipboard when it still holds that pasted text. CWS does not write a phrase. Console export is log text, not a seed |
| Android `FLAG_SECURE` on secret screens in release. iOS app-switcher blur and a capture warning | Pass. The iOS warn-only choice is intentional | `preventScreenCapture` blacks the live window whenever iOS reports a capture, including mirroring and Control Center. CWS does not do that. It warns and blurs the app switcher. Another camera can photograph the screen. Debug Android skips `FLAG_SECURE` only while `__DEV__` is true |
| Release manifest blocks `SYSTEM_ALERT_WINDOW` | Pass | Debug still allows cleartext traffic for Metro. Release does not merge that manifest |
| Public account and xpub reads confirm on the phone | Pass for the phone policy | Firmware P1=0 stays silent in protocol tests. The phone sets `confirmSilentPublic`. One confirm covers that read plus the next 15 public reads for 60 seconds. It does not cover a signature. Disconnect and lock clear the batch. This is not a Ledger wire MATCH |
| BLE link key where the OS exposes it. Session cleared on disconnect | Pass, with a gap | iOS CoreBluetooth does not expose the bond, so those hosts use the phone confirm. Disconnect resets the link, the allowed central, and the pairing code. It does not wipe the vault |
| VoiceOver and TalkBack do not speak the recovery words | Pass | The grid label is `Recovery word N`. The letters stay on screen for the person looking at it |
| Proxy does not store a seed and redacts mnemonic-like lines and long hex in its log | Pass | The proxy still forwards every APDU the phone accepts. It is transport only |

## What the software does

- A new BIP39 or SLIP-39 secret comes from the operating-system CSPRNG. The mnemonic and the SLIP-39 shares are shown so they can be written down. They are not written to the clipboard. The system copy menu is disabled on fields that hold a phrase, a share, entropy, a verify word, or a passphrase. Import reads the clipboard only after the Paste confirm. A successful import then clears the clipboard when it still holds that text.
- The stored value is entropy, or the SLIP-39 secret, in `expo-secure-store`, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. A release build also sets `requireAuthentication`. The web build refuses to store it. A passphrase stays in memory for the session and is wiped on lock. `lockVaultMemory` drops the cached secret.
- A release build asks the OS authenticator before a secret is revealed, imported, saved, or applied as a passphrase, and again before a signature or a backup-seed QR is produced. Debug builds skip the reveal prompt so a lab session can run. Sign and seed export on a debug build follow the Settings toggle. A release build asks even when that toggle is off.
- Vault, import, generate, the passphrase sheet, a backup-seed QR, and the seed-export confirmation are secret screens. Android release sets `FLAG_SECURE` on those screens. The debug skip is `__DEV__` only. iOS blurs the app switcher and shows a warning when the OS reports a capture. Leaving the live image visible is intentional: blanking it also blanks mirroring and Control Center.
- Recovery words are visible and are not an accessibility label. The spoken name is the word index. Masked passphrase fields expose the field name, not the secret.

## What stays open, on purpose

Closing the items below would stop real wallets from connecting. They are residual risk. 1.1.3 does not claim to have removed them.

### WebHID

The proxy forwards HID reports to the phone as APDUs. There is no command allowlist. A site you connect in Chrome can send any command the phone already implements, including a silent address or extended-public-key read. A signature and a seed export still wait for the phone.

### trezord

The local bridge listens on `127.0.0.1` and reflects the request `Origin` (or `*` when Origin is absent). Trezor-compatible wallets need that behaviour. Any browser origin on the same machine can talk to the bridge while it is running. Signatures still confirm on the phone.

### Public export on the phone

The phone confirms public account and xpub reads, including firmware P1=0. One confirm covers that read and the next 15 public reads for 60 seconds. A signature is not included. Disconnect and lock end the batch. Protocol tests without `confirmSilentPublic` still follow the silent firmware path. That flag is a hot-wallet policy. It is not a claim that the Ledger app confirms those reads. A chain code in the reply is still not the seed.

### Keychain

Release writes set `requireAuthentication`. The decision is `keychainRequiresAuthentication(isDevBuild())`, and `isDevBuild()` is only Metro's `__DEV__`. After one successful read the value stays in process memory until lock, so a host session does not prompt the authenticator on every address. Reveal and backup pass `forceAuth` and read the keychain again. iPhone Mirroring can still fail a prompt that the OS raises. The in-memory copy is not a secure element.

## Platform limits

- **iOS screenshots and mirroring.** Warn-only is intentional. `preventScreenCapture` paints the live window black whenever iOS reports a capture, including mirroring and Control Center. CWS blurs the app switcher and shows a warning instead. Another camera can photograph the screen. There is no polling loop. Android release still sets `FLAG_SECURE`. That skip is `__DEV__` only.
- **iOS BLE link key.** The operating system does not expose it. A signature still requires confirmation of the host when the link key is absent. Disconnect clears the link, the allowed central, and the pairing code. The link is not bound to an OS pairing key on iOS.
- **Proxy.** The desktop app does not write a seed to disk. Its status log redacts a 12-or-more-word line and hex runs of 64 characters or more. It still forwards host APDUs to the phone.
- **Debug builds.** `SYSTEM_ALERT_WINDOW` is absent from the debug manifest and from the release manifest. Debug still allows cleartext traffic so Metro can load the bundle. Release does not merge the debug manifest. The screenshot listener declares `DETECT_SCREEN_CAPTURE`. That is not an overlay permission.
- **Release signing.** A Play upload build is signed from the publisher’s environment. This repository contains no keystore and no upload password. If that configuration is absent, release packaging fails instead of signing with the debug key. A debug phone does not prove the release authenticator prompt.

## Known host gaps

These behaviours are not finished in 1.1.0. They are usability gaps. They are not a reason to drop the public-read confirm.

- Phantom may not complete unlock after connect.
- Rabby’s camera may still fail to scan the phone QR. The static account PNG is ECC M, a four-module quiet zone, 8 px modules, and black-on-white (`qrPng.ts`). On 2026-10-31, host `ki-mac-mini` encoded that PNG for the OneKey and Keystone account profiles. Local `zbarimg` 0.23.95 decoded both files. That is not a wallet scan. Rabby was not opened: Chrome’s extension directory returned `Operation not permitted`, and an unpacked Rabby 0.94.13 tree was not loaded. OneKey.app 6.6.3 was not given a scan session. No Keystone wallet app is installed. Continuity Camera is enumerated as the lab iPhone, and ffmpeg timed out without a frame while Preview showed the PNG. The attempt is host-only KEEP in [testing.md](testing.md). Unimplemented Keystone UR types stay out of the export.
- Avalanche Core may not list Avalanche X and P accounts end to end.
- OKX may not show asset balances for an imported account.

Address export and the signing sheet are covered by the automated suites in [testing.md](testing.md). Ledger Live’s genuine-device check is not expected to pass. CWS does not present itself as Ledger Live, Trezor Suite, or the OneKey app.

## What a reader should assume

Anyone who can unlock the phone, debug the process, photograph the screen, or connect a host can reach more than the UI shows. Treat every secret entered here as compromised for any purpose that matters.
