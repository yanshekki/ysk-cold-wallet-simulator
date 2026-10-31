# Contributing

CWS is published so its behaviour and its limits can be reviewed. Pull requests are welcome. A merged change is not a request to hold real funds with this software.

The repository is under the [MIT License](LICENSE). Copyright © 2026 YSK Limited. Product limits stay in [docs/security.md](docs/security.md).

**Seeds are not absolutely safe.** Do not write a pull request, a commit message, or a document that says a change makes seeds absolutely safe.

## Security reports

Open a GitHub issue on this repository. Describe the impact and the versions. Do not include a live seed, a passphrase, or a keystore, including a test secret from a phone. This repository does not publish a separate disclosure address. See [SECURITY.md](SECURITY.md).

## Before you open a pull request

- Run `yarn test` for the workspaces you touch. Protocol changes need the package tests. Phone UI changes should keep the Maestro flows honest. Proxy page changes can use `yarn workspace @cws/proxy test:e2e`.
- Do not add a recovery phrase, passphrase, keystore, provisioning profile, `.env` file, or upload password. Tests must use the public test vectors already in the suite, not a secret from a device.
- Do not commit `chrome/`, `DerivedData/`, `apps/proxy/dist/`, `apps/mobile/android/`, or `apps/mobile/ios/`. Those are local. The root `.gitignore` already excludes keystores, profiles, and `.env` files.
- The Apple team identifier in the phone app and the macOS proxy is the publisher’s team. A fork that signs its own build must replace it. Do not add a personal certificate common name to `package.json` or to shell scripts. Pass the identity in the environment when a script requires it.
- User-facing copy for Hong Kong Chinese belongs in `apps/mobile/src/i18n/locales/zh-HK.ts`. Use formal written Traditional Chinese, not a transcription of speech, and not Simplified Chinese.
- If a mitigation would stop a third-party wallet from connecting or from listing accounts, say so in the pull request and leave the compatible path in place.

Phone build steps are in the [README](README.md) quick start. The macOS CWS Proxy app is [docs/proxy-macos.md](docs/proxy-macos.md). What a handset run did and did not cover is in [docs/testing.md](docs/testing.md).

## Signing material stays out of git

Play upload signing is wired in `apps/mobile/plugins/withReleaseUploadSigning.js`. The macOS app script is `apps/proxy/macos/xcode-app.sh`. `apps/proxy/macos/pack.sh` is a separate packager and requires a signing identity and a profile in the environment.

Put paths, identities, and passwords in your environment. Do not commit them, and do not paste them into docs or issues. If upload signing is unset, release packaging fails instead of signing with the debug key.

## Scope that is intentionally open

WebHID command filtering, a trezord origin lockdown, and a confirmation on every extended public key break the hosts this project already speaks. Do not send those as drive-by hardening. [docs/security.md](docs/security.md) records them as residual risk for 1.1.3.
