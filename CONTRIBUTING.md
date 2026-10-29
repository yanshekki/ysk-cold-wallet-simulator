# Contributing

CWS is published so the implementation can be reviewed. Pull requests are welcome. They are not a request to hold real funds with this software.

## Before you open a change

- Run `yarn test` for the workspaces you touch. Protocol changes need the package tests. Phone UI changes should keep the Maestro flows honest.
- Do not add a recovery phrase, passphrase, keystore, provisioning profile, `.env` file, or upload-store password. Tests must use the existing public test vectors already in the suite, not a secret from a device.
- Do not commit `chrome/`, `DerivedData/`, `apps/proxy/dist/`, `apps/mobile/android/`, or `apps/mobile/ios/`. Those are local.
- The Apple team identifier in the phone app and the macOS proxy is the publisher’s team. A fork that signs its own build must replace it. Do not add a personal certificate common name to `package.json` or shell scripts. Pass `CWS_CODESIGN_IDENTITY` and `CWS_PROFILE` in the environment.
- Do not claim that a change makes seeds absolutely safe. If a mitigation would stop a third-party wallet from connecting or from listing accounts, say so in the pull request and leave the compatible path in place.
- User-facing copy for Hong Kong Chinese belongs in `apps/mobile/src/i18n/locales/zh-HK.ts` and should be written Chinese, not a transcription of speech.

## Scope that is intentionally open

WebHID command filtering, trezord origin lockdown, and a confirmation on every extended public key break the hosts this project already speaks. Do not send those as drive-by hardening.

## Security reports

Describe the impact and the versions. Do not include a live seed, even a test one from your phone. The public model is [docs/security.md](docs/security.md).
