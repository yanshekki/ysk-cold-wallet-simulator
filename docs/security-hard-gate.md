# Security hard gate

Standing record of what CWS does and does not promise for seeds. Decision map for 2026-10-29: `docs/device-accept-20261029/residual-safest-usable-plan.md`.

**Seeds are not absolutely safe.** This software has no secure element. Do not put a seed that controls real funds on the device.

## Closed in code

- Recovery phrases, shares, and entropy are not written by `copyText`. Kind `secret` returns false before `expo-clipboard` (#23).
- Seed, share, entropy, verify-word, and passphrase fields disable the system copy menu (`contextMenuHidden`, `selectTextOnFocus={false}`) and do not select the secret on focus. Masked passphrase fields expose the field name to accessibility, not the secret. The word grid does not set `accessibilityLabel` or `accessibilityHint`.
- Import Paste still **reads** the clipboard. That is an explicit user action.
- Vault, Import, and Generate warn on OS screenshot (`vault.screenshot`) and take the secret-screen guard. Android **release** sets `FLAG_SECURE` on that guard. Android **debug** does not, so screenshot QA can see the UI. iOS uses app-switcher blur, not `FLAG_SECURE`.
- Secret-screen holders are refcounted. Passphrase entry, a `crypto-seed` QR, and a seed-export confirm join the same guard only while they are on screen.
- Release builds call the OS authenticator before seed reveal, import, save, passphrase apply, sign, and seed export. Debug skips the reveal prompt. Debug still prompts for sign / seed export when the Settings toggle is on, and release prompts for those even when the toggle is off (`needsSignReauth`).
- `android.permission.SYSTEM_ALERT_WINDOW` is in `blockedPermissions` and is marked `tools:node="remove"` on the debug and debugOptimized manifests by `plugins/withBlockedDebugPermissions.js`. It is not in the granted permission list. Release does not merge `src/debug`.

## KEEP — keychain

Entropy is stored with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` and **without** `requireAuthentication`.

`expo-secure-store` would prompt on every `getItemAsync`. `loadEntropy` runs while a host lists accounts (silent address / xpub). That prompt breaks Phantom, Rabby, Core, OKX, and the other hosts, and it fails under iPhone Mirroring. The read path can still open an older item that was stored with authentication, on release only. New writes do not use that flag.

Consequence: after the device is unlocked, the app process can read the entropy blob without a fresh biometric. Session unlock and the release reveal / sign prompts are app-layer checks, not a keychain ACL.

## KEEP — protocol

These stay because closing them breaks real wallet connect or account listing. The Device screen shows “a connected host can derive addresses from this seed” while advertising. That line does not block connect.

### WebHID arbitrary APDU

`apps/proxy` forwards HID reports to the phone as APDUs. There is no CLA/INS allowlist. A site the user connects in Chrome can send any command the phone handler implements, including silent account export. Sign and seed-export commands still wait for the phone. An allowlist would drop commands working hosts send.

### trezord Origin

The local bridge listens on `127.0.0.1` and reflects the request `Origin` (or `*` if Origin is absent). Trezor-compatible wallets need that. Any browser origin on the machine can talk to the bridge while it is running. Signatures still confirm on the phone. The proxy UI’s own POST guard is stricter and is a different server.

### Silent chain code / xpub

Vendor-compatible silent reads stay silent: Ethereum `GET_ADDRESS` with P1=0, Solana pubkey with P1=0, Bitcoin extended pubkey, and the same pattern on the other apps. Where the command includes a chain code or xpub, the host receives it. That is enough to list accounts and derive further public children. It is not the seed. A confirm on every account is the spam those wallets do not accept. P1=1 address display still confirms.

## Debug vs release permissions

Granted on both debug and release (main manifest): `INTERNET`, Bluetooth (including advertise and connect), `USE_BIOMETRIC`, `CAMERA`. `INTERNET` is the React Native / Expo runtime permission. This gate does not claim the release APK is network-incapable.

Removed from the merged manifest via `blockedPermissions` (main, and the debug source sets through the plugin): `SYSTEM_ALERT_WINDOW`, location, storage / media read, `BLUETOOTH_SCAN`, vibrate, foreground-service permissions, `POST_NOTIFICATIONS`, `ACCESS_NETWORK_STATE`, `ACTIVITY_RECOGNITION`.

Debug-only, still present after the overlay remove:

- `android:usesCleartextTraffic="true"` on `src/debug` and `src/debugOptimized`, for Metro. This is not a `uses-permission`. Release has no debug source set, so it does not set cleartext.

A tree under gitignored `apps/mobile/android/` that was generated before the plugin ran can still list `SYSTEM_ALERT_WINDOW` until prebuild or the plugin runs again. After that plugin is applied, the debug APK installed on the Seeker on 2026-10-29 does not declare it. `aapt dump permissions` listed Bluetooth (including advertise and connect), `CAMERA`, `DETECT_SCREEN_CAPTURE`, `INTERNET`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, and the app's own non-exported receiver permission. `DETECT_SCREEN_CAPTURE` is the Android 14 screenshot listener used by the warning toast. `USE_FINGERPRINT` is the library companion of `USE_BIOMETRIC`. Neither is an overlay. The package dump no longer grants `SYSTEM_ALERT_WINDOW`. Notes and screenshots: `docs/device-accept-20261029/`.

## Release OS reauth blocker

The prompt code is in the repo. Installing a release build is not.

`plugins/withReleaseUploadSigning.js` points `signingConfigs.release` at:

- `CWS_UPLOAD_STORE_FILE`
- `CWS_UPLOAD_STORE_PASSWORD`
- `CWS_UPLOAD_KEY_ALIAS`
- `CWS_UPLOAD_KEY_PASSWORD`

`file()` runs only when `CWS_UPLOAD_STORE_FILE` is set, so a debug build still configures. No path, password, or keystore is in git. If those variables are unset, release packaging fails. It is not pointed at the debug keystore, and no keystore was created for this change. Debug builds still skip the reveal prompt, so a debug phone does not prove the release authenticator.

## OS residuals

- **iOS screenshot.** `preventScreenCaptureAsync` blacks the live window whenever iOS reports capture (mirroring, USB, Control Center). CWS does not use it. App-switcher blur and the screenshot toast are what iOS gets. Another camera can still photograph the screen. There is no capture-polling loop.
- **iOS BLE link key.** Not available from the OS. A signature still requires host confirm when the link key is absent (#24). The link is not bound to an OS pairing key on iOS.

## Accessibility residual that stays

Visible recovery words are on screen so a person can write them down. VoiceOver and TalkBack can read that text. Hiding it would stop a blind person from transcribing the backup. Masked fields do not put the secret in `accessibilityLabel` or `accessibilityHint`. There is no covered glyph layer; nothing is marked `accessibilityElementsHidden` for that reason.

System copy is disabled in the React Native field. An OEM keyboard, a hardware keyboard shortcut, or an accessibility service can still read a focused field. That is not closed.
