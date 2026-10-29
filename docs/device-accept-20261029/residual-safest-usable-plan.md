# Residual plan — safest usable (2026-10-29)

Base: `origin/main` `8e1c31f` (screenshot toast + debug `SYSTEM_ALERT_WINDOW` remove, #28).

Decision already made: prefer safety when it conflicts with convenience, and do not break third-party wallet connect or account listing (Phantom, Rabby, Core, OKX, and the other hosts this app already speaks). Seeds are **not** absolutely safe. This file is the map. Standing residuals live in `docs/security-hard-gate.md`.

Usability gaps (Phantom unlock, Rabby QR camera, Core X/P, OKX assets) stay deferred.

## A — FIX

| Residual | Action | Why | UX |
| --- | --- | --- | --- |
| Import / seed system copy | **FIX.** Seed, share, entropy, verify-word, and passphrase `TextInput`s use `secretInputProps`: `contextMenuHidden`, `selectTextOnFocus={false}`, autofill off. No new clipboard writes. Paste stays an explicit read on Import. Recovery text stays `selectable={false}`. Seed-export confirm text is not selectable. | Matches clipboard refuse (#23). The system menu was still a copy path. | Editing still works. System Copy / Select all on those fields is off. Paste is the Import button, not the system menu. |
| Secret-screen hygiene | **FIX.** Vault, Import, and Generate still call `useSecretScreenshotWarning` (toast from #28). Holders are refcounted so closing Import does not clear Android `FLAG_SECURE` while Vault is still mounted. Passphrase sheet, `crypto-seed` QR, and seed-export confirm mount the same guard only while visible. | A single unmount was clearing the flag for every other secret screen. | Device QR account codes stay screenshotable until the format is the backup seed. Android release still blacks captures on secret screens. Debug still allows `adb screencap`. |
| Keychain `requireAuthentication` | **KEEP** (would brick). Entropy stays `WHEN_UNLOCKED_THIS_DEVICE_ONLY` without `requireAuthentication`. | `expo-secure-store` prompts on every read. `loadEntropy` runs for silent address and xpub listing. That prompt breaks account listing and fails under iPhone Mirroring (“continue on iPhone”). | No extra prompt while a host lists accounts. Release still reauths before reveal, import, save, sign, and seed export. |
| Debug overlay permission | **FIX, already started in #28.** `blockedPermissions` includes `SYSTEM_ALERT_WINDOW`. `withBlockedDebugPermissions` writes `tools:node="remove"` into `src/debug` and `src/debugOptimized`. | React Native’s debug manifest is higher priority than main, so a main-only remove left the permission in the debug APK. | No overlay permission. Debug Metro still uses cleartext. See the hard gate for the remaining debug-only flag. |
| Accessibility | **FIX where the UI is masked.** Masked passphrase fields use an accessibility label that is the field name, not the secret. Import no longer copies a correct word into `accessibilityLabel`. The word grid has no `accessibilityLabel` or `accessibilityHint`. | A label was a second copy of plaintext. | Visible backup words stay in the accessibility tree so VoiceOver / TalkBack can transcribe them. Non-secret controls are unchanged. There is no covered-glyph layer to hide. |
| Release OS reauth | **FIX in code. Device proof blocked.** Release reveal / import / save calls `reauthBeforeReveal` (`unlock` with `requireOsPrompt`). Release sign and `export-seed` still use `needsSignReauth`, which is true even if the Settings toggle is off. `withReleaseUploadSigning` points a release build at `CWS_UPLOAD_STORE_FILE` and the matching password, alias, and key password env vars. | Hold alone is not an authenticator. | Debug lab runs do not prompt again for reveal. Release does. No keystore was created. |

## B — KEEP (protocol / compat)

No behavior change. A session line on Device, shown only while advertising, says a connected host can derive addresses. It does not block Start, connect, or listing.

| Residual | Action | Threat | Why it stays |
| --- | --- | --- | --- |
| WebHID arbitrary APDU | **KEEP** | Any site the user grants in Chrome can send the APDUs the phone already implements, including silent address / xpub. Sign and seed export still wait for the phone. | An allowlist drops APDUs that Phantom, Rabby, Core, OKX, and other hosts actually send. The proxy forwards HID reports in `apps/proxy/src/adapters/ledger.ts`. |
| trezord Origin | **KEEP** | `trezord` on `127.0.0.1` reflects `Access-Control-Allow-Origin` from the request, or `*` when Origin is absent. A browser page on the same machine can call the bridge while the proxy is running. | Trezor-compatible wallets require that open bridge CORS. Tightening it breaks those hosts. Sign still confirms on the phone. |
| Silent chain code / xpub | **KEEP** | A connected host can list accounts and, where the vendor command includes it, receive a chain code or xpub without a confirm per address. That is watch-only material, not the seed. With a chain code the host can derive further public children. | Wallets list accounts with silent `GET_ADDRESS` / pubkey / xpub (Ethereum P1=0, Solana P1=0, Bitcoin extended pubkey, and the same pattern on other apps). A confirm per account is the spam these hosts do not accept. |

## C — OS residuals (no fake fix)

| Residual | Action | What we do not claim |
| --- | --- | --- |
| iOS screenshot / Continuity Camera black | **Document.** iOS `preventScreenCaptureAsync` re-parents the window and paints black while the screen is captured, including mirroring and Control Center. CWS does not call it. iOS uses app-switcher blur plus the screenshot toast. Android release still sets `FLAG_SECURE`. | iOS cannot promise a black screenshot. No `UIScreen.isCaptured` poll was added. |
| BLE link key on iOS | **Document.** iOS does not expose the LE link key. Host confirm before a signature is already required (#24) when the link key is missing. | The radio is not bound to an OS link key on iOS. |

## Honest gate

Seeds are not absolutely safe after this change. Another camera, an accessibility service on a visible phrase, a connected host’s silent xpub, WebHID, trezord, a debug build, and the process that owns the keychain item can still reach secret material. Details and the release-build blocker are in `docs/security-hard-gate.md`.

Device check on the Seeker (Android 16, debug): `docs/device-accept-20261029/android-debug-notes.md`. Release OS reauth was not installed. `CWS_UPLOAD_STORE_FILE` is unset, and no keystore was created.
