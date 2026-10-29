# What was tested

Version 1.1.0 (build 6) is a release of the code on main, with the version number, public documentation, and removal of local signing identity from the tree. It does not add a new handset pass of its own.

## Automated

- `yarn test` runs the workspace Vitest suites: protocol handlers, QR, the vault, clipboard refusal, secret-screen refcount, release re-authentication policy, and the proxy.
- `yarn workspace @cws/proxy test:e2e` runs Playwright against the proxy page.
- Maestro YAML under `apps/mobile/.maestro` and `apps/proxy/.maestro` drives the phone UI and the proxy shell. Those flows do not advertise BLE.

Run the suites on a change that touches protocol or UI. A green run is the regression gate for this repository. It is not a statement that every third-party wallet screen was accepted.

## Handset, October 2026

An Android 16 handset installed a **debug** build of the then-current app (`versionName` 1.0.4, the code that 1.1.0 publishes). The checks were:

- `aapt dump permissions` on that debug APK did not list `SYSTEM_ALERT_WINDOW`. The package dump no longer showed it granted. The APK did declare Bluetooth (including advertise and connect), camera, `DETECT_SCREEN_CAPTURE`, `INTERNET`, `USE_BIOMETRIC`, and `USE_FINGERPRINT`.
- The Import screen was opened with an empty phrase field. A long-press showed the cursor and the keyboard. The system copy menu did not appear. The explicit Paste control remained. The accessibility node’s content description was empty; the text was the placeholder.
- A system screenshot on that screen caused Android to report that CWS had detected the screenshot. The debug build still allows the capture, which is expected. The release `FLAG_SECURE` path was not installed: `CWS_UPLOAD_STORE_FILE` was unset, and no keystore was created for the check.

Screenshots of the empty Import screen, the long-press, and the screenshot disclosure are in this directory:

- [android-import-empty.png](testing/android-import-empty.png)
- [android-import-longpress.png](testing/android-import-longpress.png)
- [android-screenshot-listener.png](testing/android-screenshot-listener.png)

They do not contain a recovery phrase, a share, or a passphrase.

## Not claimed

- A release build’s OS authenticator prompt was not shown on a device.
- iOS screenshot behaviour was not re-checked for this version note. The iOS limit is described in [security.md](security.md).
- Phantom unlock, Rabby camera scan, Core Avalanche X/P listing, and OKX asset display were not closed. See Known host gaps in the security document.
- No test used a secret that controls real funds. Do not add one.
