# Testing record

**Through 1.1.3 (build 9).** [YSK Limited](https://ysk.hk) · [ysk.hk/products/ysk-cold-wallet-simulator](https://ysk.hk/products/ysk-cold-wallet-simulator)

This page records the 1.1.0 (build 6) handset pass and what later notes added through the 1.1.3 tree. A green suite is not a certificate that every third-party wallet screen works, and it is not a statement that a seed is safe.

**Seeds are not absolutely safe.** See [security.md](security.md). The same record in 繁體中文（香港） is below.

## What 1.1.0 is

1.1.0 (build 6) publishes the code on main, with this version number, public documentation, and removal of local signing identity from the tree. It does not add a new handset pass of its own. User-reported near.com, Core, Rabby, and app.rhea.finance sessions are listed under Third-party hosts.

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

Four device sessions, reported by a person in October 2026. Each row is that host on that path. Seeds are not absolutely safe. See [security.md](security.md). This page does not record which secret a session used.

| Host | Path | Reported result |
| --- | --- | --- |
| near.com | Ledger over Bluetooth (BLE) | Login succeeded. One transaction succeeded. |
| Core (core.app) | CWS Proxy (wired to the host), Ledger identity | Avalanche C-Chain → X-Chain → P-Chain → X-Chain → C-Chain export/import succeeded. |
| Rabby Wallet on lfj.gg (Trader Joe / LFJ) | CWS Proxy (wired to the host), Ledger identity | One trade on lfj.gg succeeded. |
| app.rhea.finance (Rhea Finance) | Ledger over Bluetooth (BLE) on a CWS iPhone | Login succeeded. One transaction succeeded. |

The near.com phone was an iPhone running 1.1.0 (build 6). That tree includes the Near sign-message sheets and the Ledger catalog version picker. The phone advertised as Ledger over Bluetooth. near.com finished login, and one transaction finished.

Core connected to a Ledger identity on CWS through CWS Proxy. The host path in this report is the proxy. Core finished the export/import round-trip across C-Chain, X-Chain, and P-Chain in the order above. The row records core.app on CWS Proxy for that sequence. Other Avalanche hosts are outside this report. The separate gap remains: Avalanche Core may not list X and P accounts end to end. See the list below and [security.md](security.md).

Rabby Wallet, the browser extension, signed one trade on lfj.gg (Trader Joe / LFJ). The phone was an iPhone running 1.1.0 (build 6) after tip 0fbbf4c (#43). The device path is the Core Proxy setup: a Ledger identity on CWS through CWS Proxy, wired HID on the host forwarded to the phone over BLE. The person reported that the trade succeeded (「成功係 lfj.gg 交易」). Before that commit, this path stopped with no confirm sheet: an open Ethereum SIGN chunk (e0/04) drew no ACK. This row is the success reported after that ACK. It records that one Rabby trade on lfj.gg through CWS Proxy. Other exchanges, and Rabby over Bluetooth without the proxy, are outside this report. The static account PNG layout is covered by `apps/mobile/src/qr/qrPng.test.ts` (ECC M, four-module quiet zone, 8 px modules, full black-on-white contrast). A host attempt on 2026-10-31 is KEEP and is written below. It is not a Rabby, OneKey, or Keystone scan. See [security.md](security.md). `apps/mobile/.maestro/device-qr-scan-close.yaml` allows the camera, waits for `device-qr-scanner-preview`, then asserts that preview is visible and `device-qr-scanner-waiting` is not. The flow fails if the preview never mounts after the grant.

app.rhea.finance (Rhea Finance) connected to a CWS iPhone that advertised as Ledger over Bluetooth. The host path in this report is that BLE session. Login succeeded, and one transaction succeeded. The person reported that login and the transaction succeeded (「成功用 ledger 藍牙登入及交易成功」). This row records that login and that transaction on app.rhea.finance. CWS Proxy is outside this report. Other Near hosts and other DEX hosts are outside this report. Seeds are not absolutely safe. See [security.md](security.md).

## Not tested, and not claimed

- A release build’s OS authenticator prompt was not shown on a device for 1.1.0.
- iOS screenshot behaviour was not re-checked on a device for the 1.1.0 record. The iOS limit is described in [security.md](security.md).
- Phantom unlock, a live Rabby scan of the static account PNG, Avalanche Core X/P listing, and OKX asset display were not closed. The 2026-10-31 attempt below is host-only KEEP. The PNG layout itself is tested. See known host gaps in the security document.
- The automated suites, the October Android handset checks, and the Ubuntu package checks did not use a secret that controls real funds. Do not add one.

## Static account PNG, 2026-10-31

KEEP. This is not a MATCH. Seeds are not absolutely safe.

Host `ki-mac-mini`. The PNG is the current `encodeQrPng` default for the OneKey and Keystone account profiles (`crypto-hdkey`, public test mnemonic): ECC M, four-module quiet zone, 8 px modules, black on white. Both symbols are 61 modules and 552 px wide. The files were not committed.

Local decoder only. `zbarimg` 0.23.95 read each file as one uppercase `UR:CRYPTO-HDKEY` payload, 316 bytes for OneKey and 320 bytes for Keystone, byte-identical to `payloadForQr` of that encoder. That check is not Rabby, OneKey, or Keystone.

Wallet hosts that did not scan it:

- Google Chrome is installed. Reading `~/Library/Application Support/Google/Chrome/Default/Extensions` returned `Operation not permitted`. Rabby was not opened. An unpacked Rabby 0.94.13 tree at `Documents/cws-test-screenshots/chrome-ext/rabby` was not loaded. There is no Rabby app.
- OneKey.app 6.6.3 (build 2026102381) is installed. No OneKey scan or import window was opened.
- No Keystone wallet app is installed.

Camera. AVFoundation listed OBS Virtual Camera, Shek Ki的iPhone的相機 (iPhone18,3 Continuity Camera), Shek Ki的iPhone桌上視角攝影機, and Capture screen 0. Preview showed the OneKey PNG. ffmpeg wrote no frame. A 5 fps open was rejected. A yuv420p open was rejected. The desk-view camera rejected 1280x720. A second open at 30 fps, pixel format uyvy422, 1280x720 for the iPhone camera and 1920x1440 for desk view, timed out at 15 seconds each. Screen capture was not used as a scan. Continuity Camera did not deliver a frame, and it was not attached to a Rabby or OneKey window.

Classification: host-only KEEP.

## 繁體中文（香港）

**截至 1.1.3（組建編號 9）。** [YSK Limited](https://ysk.hk) · [ysk.hk/products/ysk-cold-wallet-simulator](https://ysk.hk/products/ysk-cold-wallet-simulator)

本頁記錄 1.1.0（組建編號 6）的實機檢查，以及其後直到 1.1.3 原始碼樹的補充。綠色測試套件不是每家第三方錢包畫面都已通過的證明，亦不是種子安全的聲明。

**種子並非絕對安全。** 見上文與英文 [security.md](security.md) 的同一頁。

### 1.1.0 是甚麼

1.1.0（組建編號 6）把程式發布在 main，連同這個版本號、公開文件，以及從版本庫移除本機簽署身份。它本身沒有另一次實機驗收。使用者報告的 near.com、Core、Rabby 與 app.rhea.finance 會話見〈第三方主機〉。

### 自動測試

- `yarn test` 運行工作區的 Vitest：協議處理、二維碼、種子庫、拒絕剪貼簿、秘密畫面計數、正式組建重新認證政策，以及代理程式。
- `yarn workspace @cws/proxy test:e2e` 以 Playwright 測試代理程式頁面。在 `apps/proxy` 內，同一套件是 `yarn test:e2e`。
- `apps/mobile/.maestro` 與 `apps/proxy/.maestro` 的 Maestro 流程驅動手機介面與代理程式外殼。這些流程不作藍牙廣播。Java 須在 `PATH`。

改動協議或介面時請跑這些套件。綠色結果是本版本庫的回歸門檻。

### 實機，2026 年 10 月

一部 Android 16 手機安裝了當時應用程式的**除錯**組建（`versionName` 1.0.4，即 1.1.0 所發布的程式）。檢查如下：

- 該除錯 APK 的 `aapt dump permissions` 沒有列出 `SYSTEM_ALERT_WINDOW`。套件傾印亦不再顯示已授予。APK 有聲明藍牙（包括廣播與連線）、相機、`DETECT_SCREEN_CAPTURE`、`INTERNET`、`USE_BIOMETRIC` 及 `USE_FINGERPRINT`。
- 匯入畫面的助記詞欄為空。長按出現游標與鍵盤。系統複製選單沒有出現。畫面上的「貼上」仍然存在。無障礙節點的內容描述為空。文字是佔位提示。
- 在該畫面做系統截圖後，Android 報告 CWS 已偵測到截圖。除錯組建仍允許擷取，這是預期行為。正式組建的 `FLAG_SECURE` 沒有安裝：Play 上架簽署未設定，該次檢查亦沒有建立金鑰庫。

空白匯入畫面、長按及截圖提示的截圖在此目錄：

- [android-import-empty.png](testing/android-import-empty.png)
- [android-import-longpress.png](testing/android-import-longpress.png)
- [android-screenshot-listener.png](testing/android-screenshot-listener.png)

圖中沒有助記詞、份額或密語。

### Ubuntu 安裝包

`bash apps/proxy/linux/check-deb.sh` 檢查 `.deb` 的結構。結構檢查用的安裝包（ELF 佔位檔）不可安裝。可運行的 amd64 與 arm64 套件曾在 Ubuntu 容器內以 `apt` 組建並安裝：

- `dpkg-deb` 接受這兩個封存。
- `cws-proxy --help` 印出用法，這會載入原生附加元件。
- `http://127.0.0.1:8788/` 回傳代理程式頁面。
- `/usr/lib/udev/rules.d/99-cws-uhid.rules` 與 `apps/proxy/udev/99-cws-uhid.rules` 相符。
- `/etc/modules-load.d/cws-proxy.conf` 的內容是 `uhid`。

arm64 套件曾在 Ubuntu 24.04 與 Ubuntu 22.04 安裝。在 22.04，`apt-get remove` 刪除了 udev 規則與 modules-load 檔。amd64 套件曾在 Ubuntu 24.04 安裝。

那些容器的核心沒有 `uhid` 模組，亦沒有 udev 守護行程，所以 `modprobe uhid` 與 `udevadm control --reload-rules` 在那裡沒有成功。安裝仍然完成。該次沒有開啟 `/dev/uhid`，沒有以 `plugdev` 桌面使用者登入，亦沒有連接手機。`.github/workflows/cws-proxy-deb.yml` 設定為在 Ubuntu 24.04 組建、安裝並對兩個架構做冒煙測試。工作流程呈綠色只代表該項檢查。它不是桌面 `/dev/uhid` 工作階段。

### 第三方主機

2026 年 10 月有四次由一人報告的實機會話。每一列只記錄該主機在該路徑上的結果。種子並非絕對安全。見 [security.md](security.md)。本頁沒有記錄各次使用的秘密資料。

| 主機 | 路徑 | 報告的結果 |
| --- | --- | --- |
| near.com | Ledger 經藍牙（BLE） | 登入成功。一筆交易成功。 |
| Core（core.app） | CWS Proxy（接到主機的有線路徑），Ledger 身份 | Avalanche C 鏈 → X 鏈 → P 鏈 → X 鏈 → C 鏈的匯出／匯入成功。 |
| lfj.gg（Trader Joe / LFJ）上的 Rabby Wallet | CWS Proxy（接到主機的有線路徑），Ledger 身份 | lfj.gg 一筆交易成功。 |
| app.rhea.finance（Rhea Finance） | 一部 CWS iPhone 上的 Ledger 藍牙（BLE） | 登入成功。一筆交易成功。 |

near.com 的手機是一部運行 1.1.0（組建編號 6）的 iPhone。該樹包含 Near 簽署訊息表與 Ledger 目錄版本選擇器。手機以 Ledger 身份作藍牙廣播。near.com 完成登入，並完成一筆交易。

Core 經 CWS Proxy 連接 CWS 上的 Ledger 身份。此報告的主機路徑是代理程式。Core 按上表順序完成 C 鏈、X 鏈與 P 鏈之間的匯出／匯入。此列記錄 core.app 在 CWS Proxy 上的該序列。其他 Avalanche 主機不在此報告內。另一項缺口仍然保留：Avalanche Core 可能無法完整列出 X 與 P 帳戶。見下列清單及 [security.md](security.md)。

Rabby Wallet（瀏覽器擴充功能）在 lfj.gg（Trader Joe / LFJ）簽署一筆交易。手機是一部 iPhone，運行 1.1.0（組建編號 6），該次是在提交 0fbbf4c（#43）之後。裝置路徑與 Core 一列相同：CWS 的 Ledger 身份經 CWS Proxy 連接，主機側為有線 HID，報告經藍牙轉送至手機。報告者表示該筆交易成功（「成功係 lfj.gg 交易」）。在該提交之前，這條路徑會停住，確認表沒有打開：尚未結束的以太坊 SIGN 分塊（e0/04）沒有 ACK。此列是該 ACK 之後報告的成功，只記錄 Rabby 在 lfj.gg 經 CWS Proxy 的該筆交易。其他交易所，以及不經代理程式、Rabby 直接以藍牙連接的會話，不在此報告內。靜態帳戶 PNG 的版面由 `apps/mobile/src/qr/qrPng.test.ts` 涵蓋（ECC M、四模組安靜區、8 像素模組、全黑白對比）。2026-10-31 的主機嘗試是 KEEP，寫在下面。它不是 Rabby、OneKey 或 Keystone 的掃描。見 [security.md](security.md)。`apps/mobile/.maestro/device-qr-scan-close.yaml` 允許相機，等待 `device-qr-scanner-preview`，然後斷言該預覽可見，且 `device-qr-scanner-waiting` 不在。若授予權限後預覽從未掛上，流程會失敗。

app.rhea.finance（Rhea Finance）經 Ledger 藍牙連接一部運行 CWS 的 iPhone。此報告的主機路徑是該藍牙會話。登入成功，並完成一筆交易。報告者表示登入與該筆交易成功（「成功用 ledger 藍牙登入及交易成功」）。此列只記錄 app.rhea.finance 經 Ledger 藍牙的該次登入與該筆交易。CWS Proxy 不在此報告內。其他 Near 主機與其他 DEX 主機不在此報告內。種子並非絕對安全。見 [security.md](security.md)。

### 沒有測試，亦沒有宣稱

- 正式組建的作業系統認證提示沒有在 1.1.0 的裝置上顯示。
- 1.1.0 的紀錄沒有在 iOS 裝置上重測截圖行為。iOS 限制見 [security.md](security.md)。
- Phantom 解鎖、Rabby 對靜態帳戶 PNG 的實機掃描、Avalanche Core 的 X／P 列出，以及 OKX 資產顯示，均未結束。下面 2026-10-31 的嘗試是只限主機的 KEEP。PNG 版面本身有測試。見保安文件的已知主機缺口。
- 自動測試、2026 年 10 月的 Android 實機檢查，以及 Ubuntu 安裝包檢查，均沒有使用掌管真實資金的秘密資料。請勿加入。

### 靜態帳戶 PNG，2026-10-31

KEEP。這不是 MATCH。種子並非絕對安全。

主機 `ki-mac-mini`。PNG 是 OneKey 與 Keystone 帳戶設定目前的 `encodeQrPng` 預設（`crypto-hdkey`，公開測試助記詞）：ECC M、四模組安靜區、8 像素模組、黑字白底。兩個符號都是 61 個模組、寬 552 像素。那些檔案沒有提交。

只做了本機解碼。`zbarimg` 0.23.95 把每個檔案讀成一條大寫 `UR:CRYPTO-HDKEY` 負載，OneKey 為 316 位元組，Keystone 為 320 位元組，與該編碼器的 `payloadForQr` 逐位元組相同。這項檢查不是 Rabby、OneKey 或 Keystone。

沒有掃描它的錢包主機：

- 已安裝 Google Chrome。讀取 `~/Library/Application Support/Google/Chrome/Default/Extensions` 回傳 `Operation not permitted`。Rabby 沒有開啟。`Documents/cws-test-screenshots/chrome-ext/rabby` 的解包 Rabby 0.94.13 沒有載入。沒有 Rabby 應用程式。
- 已安裝 OneKey.app 6.6.3（組建 2026102381）。沒有開啟 OneKey 的掃描或匯入視窗。
- 沒有安裝 Keystone 錢包應用程式。

相機。AVFoundation 列出 OBS Virtual Camera、Shek Ki的iPhone的相機（iPhone18,3 Continuity Camera）、Shek Ki的iPhone桌上視角攝影機，以及 Capture screen 0。Preview 顯示了 OneKey PNG。ffmpeg 沒有寫出影格。5 fps 的開啟被拒絕。yuv420p 的開啟被拒絕。桌上視角相機拒絕 1280x720。第二次以 30 fps、像素格式 uyvy422 開啟，iPhone 相機為 1280x720、桌上視角為 1920x1440，各在 15 秒逾時。沒有用螢幕擷取充當掃描。Continuity Camera 沒有送出影格，亦沒有接到 Rabby 或 OneKey 視窗。

分類：只限主機的 KEEP。
