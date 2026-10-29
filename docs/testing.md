# Testing record

**Version 1.1.0 (build 6).** This page records what was run for this version, and what was not. A green suite is not a certificate that every third-party wallet screen works, and it is not a statement that a seed is safe.

**Seeds are not absolutely safe.** See [security.md](security.md).

## What 1.1.0 is

1.1.0 (build 6) publishes the code on main, with this version number, public documentation, and removal of local signing identity from the tree. It does not add a new handset pass of its own. A user-reported near.com session is listed under Third-party hosts.

## Automated

- `yarn test` runs the workspace Vitest suites: protocol handlers, QR, the vault, clipboard refusal, secret-screen refcount, release re-authentication policy, and the proxy.
- `yarn workspace @cws/proxy test:e2e` runs Playwright against the proxy page. From `apps/proxy`, the same suite is `yarn test:e2e`.
- Maestro YAML under `apps/mobile/.maestro` and `apps/proxy/.maestro` drives the phone UI and the proxy shell. Those flows do not advertise BLE. Java must be on `PATH`.

Run the suites on a change that touches protocol or UI. A green run is the regression gate for this repository.

## Handset, October 2026

An Android 16 handset installed a **debug** build of the then-current app (`versionName` 1.0.4, the code that 1.1.0 publishes). The checks were:

- `aapt dump permissions` on that debug APK did not list `SYSTEM_ALERT_WINDOW`. The package dump no longer showed it granted. The APK did declare Bluetooth (including advertise and connect), camera, `DETECT_SCREEN_CAPTURE`, `INTERNET`, `USE_BIOMETRIC`, and `USE_FINGERPRINT`.
- The Import screen was opened with an empty phrase field. A long-press showed the cursor and the keyboard. The system copy menu did not appear. The explicit Paste control remained. The accessibility node’s content description was empty. The text was the placeholder.
- A system screenshot on that screen caused Android to report that CWS had detected the screenshot. The debug build still allows the capture, which is expected. The release `FLAG_SECURE` path was not installed: Play upload signing was unset, and no keystore was created for the check.

Screenshots of the empty Import screen, the long-press, and the screenshot disclosure are in this directory:

- [android-import-empty.png](testing/android-import-empty.png)
- [android-import-longpress.png](testing/android-import-longpress.png)
- [android-screenshot-listener.png](testing/android-screenshot-listener.png)

They do not contain a recovery phrase, a share, or a passphrase.

## Ubuntu package

`bash apps/proxy/linux/check-deb.sh` checks the `.deb` layout. A layout-check package (ELF stubs) is not installable. Runnable amd64 and arm64 packages were built and installed with `apt` in Ubuntu containers:

- `dpkg-deb` accepted both archives.
- `cws-proxy --help` printed usage, which loads the native addon.
- `http://127.0.0.1:8788/` returned the proxy page.
- `/usr/lib/udev/rules.d/99-cws-uhid.rules` matched `apps/proxy/udev/99-cws-uhid.rules`.
- `/etc/modules-load.d/cws-proxy.conf` contained `uhid`.

The arm64 package was installed on Ubuntu 24.04 and on Ubuntu 22.04. On 22.04, `apt-get remove` deleted the udev rule and the modules-load file. The amd64 package was installed on Ubuntu 24.04.

Those containers have no `uhid` kernel module and no udev daemon, so `modprobe uhid` and `udevadm control --reload-rules` did not succeed there. The install still finished. This did not open `/dev/uhid`, did not log in a desktop user in `plugdev`, and did not connect a phone. `.github/workflows/cws-proxy-deb.yml` is set up to build, install, and smoke-test both architectures on Ubuntu 24.04. A green workflow run is that check. It is not a desktop `/dev/uhid` session.

## Third-party hosts

One device session, reported by a person in October 2026. An iPhone running 1.1.0 (build 6) advertised as Ledger over Bluetooth (BLE). That tree includes the Near sign-message sheets and the Ledger catalog version picker.

| Host | Transport | Login | Transaction |
| --- | --- | --- | --- |
| near.com | Ledger over Bluetooth | Succeeded | Succeeded |

near.com finished login, and one transaction finished. The row records near.com on the Ledger Bluetooth path. Seeds are not absolutely safe. See [security.md](security.md). This page does not record which secret the session used.

## Not tested, and not claimed

- A release build’s OS authenticator prompt was not shown on a device for 1.1.0.
- iOS screenshot behaviour was not re-checked on a device for this version note. The iOS limit is described in [security.md](security.md).
- Phantom unlock, Rabby camera scan, Avalanche Core X/P listing, and OKX asset display were not closed. See known host gaps in the security document.
- The automated suites, the October Android handset checks, and the Ubuntu package checks did not use a secret that controls real funds. Do not add one.
