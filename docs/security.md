# Security model

Version 1.1.0 (build 6). This document is the public statement of what CWS does and does not protect.

**Seeds are not absolutely safe.** CWS has no secure element. Do not put a seed that controls real digital assets on the device.

## What the software does

- A new BIP39 or SLIP-39 secret is generated from the operating system CSPRNG. The mnemonic and the SLIP-39 shares are shown so they can be written down. They are not written to the clipboard. The system copy menu is disabled on fields that hold a phrase, a share, entropy, a verify word, or a passphrase. Import can still read the clipboard when you press Paste.
- The stored value is entropy (or the SLIP-39 secret) in `expo-secure-store`, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. The web build refuses to store it. A passphrase stays in memory for the session and is wiped on lock.
- A release build asks the OS authenticator (biometric or device passcode) before a secret is revealed, imported, saved, or applied as a passphrase, and again before a signature or a backup-seed QR is produced. Debug builds skip the reveal prompt so a lab session can run. Sign and seed export on a debug build follow the Settings toggle; a release build asks even when that toggle is off.
- Vault, import, generate, the passphrase sheet, a backup-seed QR, and the seed-export confirmation are secret screens. Android release sets `FLAG_SECURE` for those screens. Android debug does not, so a screenshot can be taken during QA. iOS blurs the app switcher and shows a warning when the OS reports a capture. iOS does not black the live image.
- Masked passphrase fields expose the field name to accessibility, not the secret. Visible recovery words stay in the accessibility tree so they can be transcribed. A screen reader on an open secret screen can speak those words.

## What stays open, on purpose

Closing the items below would stop real wallets from connecting or from listing accounts. They are residual risk, not unfinished mistakes that 1.1.0 claims to have removed.

### WebHID

The proxy forwards HID reports to the phone as APDUs. There is no command allowlist. A site you connect in Chrome can send any command the phone already implements, including a silent address or extended-public-key read. A signature and a seed export still wait for the phone.

### trezord

The local bridge listens on `127.0.0.1` and reflects the request `Origin` (or `*` when Origin is absent). Trezor-compatible wallets need that behaviour. Any browser origin on the same machine can talk to the bridge while it is running. Signatures still confirm on the phone.

### Silent public-key export

Vendor-compatible reads stay silent: Ethereum `GET_ADDRESS` with P1=0, a Solana public key with P1=0, a Bitcoin extended public key, and the same pattern on the other apps. Where the command includes a chain code, the host receives it and can derive further public children. That is not the seed. A confirmation on every account is the prompt those wallets do not accept. Displaying an address (P1=1) still confirms. While the phone is advertising, the Device screen says that a connected host can derive addresses.

### Keychain prompt on every read

`requireAuthentication` is not set on the entropy item. The Expo API would prompt on every read, and the app reads entropy while a host lists accounts. That prompt breaks account listing and fails under iPhone Mirroring. After the device is unlocked, the app process can read the blob without a fresh biometric. The session unlock and the release reveal and sign prompts are application checks, not a keychain access-control list.

## Platform limits

- **iOS screenshots.** Calling the iOS capture block paints the live window black whenever the system reports a capture, including mirroring and Control Center. CWS does not do that. Another camera can photograph the screen. There is no polling loop.
- **iOS BLE link key.** The operating system does not expose it. A signature still requires confirmation of the host when the link key is absent. The link is not bound to an OS pairing key on iOS.
- **Debug permission.** `SYSTEM_ALERT_WINDOW` is removed from the debug manifest as well as the release manifest. Debug still allows cleartext traffic so Metro can load the bundle. Release does not merge the debug manifest. The screenshot listener declares `DETECT_SCREEN_CAPTURE`. That is not an overlay permission.
- **Release signing.** A release package reads `CWS_UPLOAD_STORE_FILE` and the matching password, alias, and key password from the environment. Nothing in git is a keystore. If those variables are unset, release packaging fails instead of signing with the debug key. A debug phone does not prove the release authenticator prompt.

## Known host gaps

These behaviours are not claimed as finished in 1.1.0. They are usability gaps, not a reason to weaken the silent account-listing path:

- Phantom may not complete unlock after connect.
- Rabby’s camera may fail to scan the phone QR in some setups.
- Core may not list Avalanche X and P accounts end to end.
- OKX may not show asset balances for an imported account.

Address export and the signing sheet are covered by the automated suites described in [testing.md](testing.md). Ledger Live’s genuine-device check is not expected to pass. CWS does not present itself as Ledger Live, Trezor Suite, or the OneKey app.

## What a reader should assume

Anyone who can unlock the phone, debug the process, photograph the screen, or connect a host can reach more than the UI admits. Treat every secret entered here as compromised for any purpose that matters.
