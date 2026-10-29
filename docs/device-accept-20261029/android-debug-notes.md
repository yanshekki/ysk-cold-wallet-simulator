# Android debug check — 2026-10-29

Device: Seeker, Android 16, `hk.ysk.cws` debug (`versionName` 1.0.4). Bluetooth was turned off only while navigating so a connected host would not cover the screen, then turned back on.

No recovery phrase, share, or passphrase was entered. Screenshots show the empty Import form.

## What the debug APK declares

`aapt dump permissions` on `app-debug.apk`:

- `android.permission.BLUETOOTH`
- `android.permission.BLUETOOTH_ADMIN`
- `android.permission.BLUETOOTH_ADVERTISE`
- `android.permission.BLUETOOTH_CONNECT`
- `android.permission.CAMERA`
- `android.permission.DETECT_SCREEN_CAPTURE`
- `android.permission.INTERNET`
- `android.permission.USE_BIOMETRIC`
- `android.permission.USE_FINGERPRINT`
- `hk.ysk.cws.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`

`SYSTEM_ALERT_WINDOW` is absent. `dumpsys package` no longer shows it granted. Before this rebuild the installed debug package had granted it. `DETECT_SCREEN_CAPTURE` is the screenshot listener, not an overlay.

## Import field

`android-import-empty.png` is the Import screen with the placeholder `BIP39 或 SLIP-39` and the name placeholder `匯入`. The seed field is empty.

`android-import-longpress.png` is a long-press on that field. The cursor and the keyboard appear. The system copy / select / paste menu does not. The explicit Paste button (`貼上`) is still on the form.

`uiautomator` on that field: `text` is the placeholder, `content-desc` is empty. TalkBack was not switched on.

## Screenshot listener

`android-screenshot-listener.png` is a system screenshot taken while Import was open. Android’s own screenshot UI then showed `CWS 偵測到此螢幕截圖。` That string is the OS disclosure that this app’s screenshot callback ran. It is not a phrase. Debug still allows the capture, which is why the form is visible. Release `FLAG_SECURE` was not installed: `CWS_UPLOAD_STORE_FILE` is unset.

## Not proven on this phone

- Release OS authenticator prompt (no upload keystore).
- VoiceOver. This is an Android device.
- iOS screenshot behavior.
