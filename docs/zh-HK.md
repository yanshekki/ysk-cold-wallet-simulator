# YSK Cold Wallet Simulator

**版本 1.1.2（組建編號 8）** · YSK Limited

手機套件識別碼 `hk.ysk.cws` · CWS Proxy 套件識別碼 `hk.ysk.cws.proxy`

本軟件給需要測試錢包互通的開發者及錢包團隊使用。手機以藍牙周邊裝置的形式，模擬指定的硬體錢包，並以供應商協議與第三方錢包通訊。

手機把 BIP39 或 SLIP-39 秘密資料存放於作業系統的安全儲存。桌面代理程式可把該手機呈現為 USB HID 裝置。帳戶資料亦可以動畫或靜態二維碼離開手機。

手機應用程式與代理程式介面提供 English、繁體中文（香港）、Español、العربية、Português、Bahasa Indonesia、Français、日本語、Русский 及 Deutsch。

English: [../README.md](../README.md)

## 警告

CWS 是模擬器。它不是安全元件。Ledger、Trezor 及 OneKey 均未認可本軟件。請勿以本軟件保管真實數碼資產。

**種子並非絕對安全。** 產生或匯入秘密資料之前，請先閱讀 [security.md](security.md)。下文〈保安模型〉與該英文文件同一要旨。

## 下載

版本 1.1.2（組建編號 8），保留 1.1.1 的熱錢包基線，並加入 Cardano 主體雜湊（#73）、Trezor 與 OneKey 傳輸測試（#74），以及 QR 預覽 settle（#75）。種子不是硬體錢包級安全。 [GitHub Release v1.1.0](https://github.com/yanshekki/ysk-cold-wallet-simulator/releases/tag/v1.1.0) 只有說明，沒有附上 APK、IPA 或桌面安裝包。Ubuntu 可以從這份原始碼組建 `.deb`。macOS 與 Windows 在該發行仍然沒有可安裝的套件。

| 產品 | 取得方式 |
| --- | --- |
| Android 手機 | [Google Play](https://play.google.com/store/apps/details?id=hk.ysk.cws)（`hk.ysk.cws`） |
| iOS 手機 | App Store：即將推出 |
| CWS Proxy（macOS） | Mac App Store：即將推出。HID Virtual Device 的 App Store entitlement 仍是 **Submitted**，尚未獲批。 |
| CWS Proxy（Ubuntu） | 套件 `hk.ysk.cws.proxy`（amd64 與 arm64）。在 Ubuntu 執行 `bash apps/proxy/linux/build-deb.sh`，再安裝該 `.deb`。套件會安裝 `cws-proxy` 及 `uhid` 的 udev 規則。GitHub Release 沒有附上這個 `.deb`。見 [Ubuntu 安裝包](#ubuntu-安裝包)。 |
| CWS Proxy（其他 Linux） | 沒有安裝包。請從原始碼執行 `yarn proxy`，並先套用快速開始所述的 `uhid` 規則。 |
| CWS Proxy（Windows） | 沒有已封裝的下載。請從原始碼先組建 `@cws/native-proxy`，再執行 `yarn proxy`。Windows 沒有虛擬 HID，因此不會建立 USB HID 裝置。本機頁面是 `http://127.0.0.1:8788`。 |

虛擬 HID 在 Linux（`/dev/uhid`，包括 Ubuntu 安裝包）及 macOS 的 CWS Proxy 應用程式實現。Windows 沒有虛擬 HID。

在 Mac App Store 版本推出之前，可用 `yarn workspace @cws/proxy app` 從原始碼組建 macOS 應用程式。該指令使用 Xcode 專案已設定的團隊。請勿把描述檔提交至版本庫。

## 快速開始

請使用一部實體 Android 或 iOS 手機。模擬器與 Expo Go 不能作藍牙廣播。

1. 從 Google Play 安裝 Android 應用程式，或從原始碼組建手機應用程式。
2. 接受警告、解鎖、選擇型號，並使用一組不掌管真實資產的秘密資料。
3. 開始廣播，然後以藍牙連接第三方錢包。
4. 桌面 WebHID 請啟動 CWS Proxy（macOS 應用程式、Ubuntu 套件的 `cws-proxy`，或在 Linux 執行 `yarn proxy`），再按 Start。Chrome 其後可開啟虛擬 USB 裝置。本機頁面是 `http://127.0.0.1:8788`。

從原始碼組建需要 Node.js、Yarn 1.22.22，以及 Xcode 或 Android Studio。代理程式的 HID 程式庫另需 Rust。

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
cd apps/mobile
npx expo prebuild
npx expo run:android   # 或 run:ios
```

從原始碼運行 Linux 代理程式時，在版本庫根目錄：

```bash
yarn workspace @cws/native-proxy build   # 一次
yarn proxy                               # http://127.0.0.1:8788
```

這條路徑不會安裝套件。請把 `apps/proxy/udev/99-cws-uhid.rules` 複製到 `/etc/udev/rules.d/`，然後重新登入。該規則把 `/dev/uhid` 的群組設為 `plugdev`，模式設為 `0660`。Ubuntu 可以用下面的套件安裝同一條規則。

### Ubuntu 安裝包

套件名稱是 `hk.ysk.cws.proxy`。這是給 Ubuntu amd64 與 arm64 的 `.deb`（需要 glibc 2.34 或更新，即 Ubuntu 22.04 與 24.04）。它會安裝：

- `/usr/bin/cws-proxy`
- 私有的 Node.js 24 運行環境，以及 `/usr/lib/hk.ysk.cws.proxy` 內的代理程式
- `/usr/lib/udev/rules.d/99-cws-uhid.rules`，與 `apps/proxy/udev/99-cws-uhid.rules` 逐位元組相同

`postinst` 在系統沒有 `plugdev` 群組時會建立它，寫入 `/etc/modules-load.d/cws-proxy.conf` 以便核心載入 `uhid`，並執行 `udevadm control --reload-rules`。`/dev/uhid` 的群組是 `plugdev`，模式是 `0660`。若你的帳戶不在 `plugdev`，請先加入，然後重新登入，虛擬 HID 才可使用。

GitHub Release v1.1.0 沒有附上這個 `.deb`。請在 Ubuntu 上組建。[`.github/workflows/cws-proxy-deb.yml`](../.github/workflows/cws-proxy-deb.yml) 會在 `ubuntu-24.04` 組建 amd64、在 `ubuntu-24.04-arm` 組建 arm64，並把每個 `.deb` 上傳為工作流程成品。該成品不是 GitHub Release 的附件。

```bash
sudo apt-get install -y build-essential pkg-config libdbus-1-dev curl ca-certificates python3 xz-utils
# 需要 Node.js 22 或更新、Yarn 1.22.22，以及 Rust（rustup）
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
yarn workspace @cws/native-proxy build
bash apps/proxy/linux/build-deb.sh
bash apps/proxy/linux/check-deb.sh apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
sudo apt-get install -y ./apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
sudo usermod -aG plugdev "$USER"   # 然後重新登入
cws-proxy                          # http://127.0.0.1:8788
```

在 arm64 的 Ubuntu 上，腳本會按 `uname -m` 選擇 arm64。可用 `--arch amd64` 或 `--arch arm64` 指定。`yarn workspace @cws/proxy deb` 就是同一個組建腳本。

不安裝、只檢查安裝包：

```bash
dpkg-deb -I apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
dpkg-deb -c apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
bash apps/proxy/linux/check-deb.sh apps/proxy/dist/linux/hk.ysk.cws.proxy_*.deb
```

安裝之後，`cws-proxy --help` 應印出用法，`/usr/lib/udev/rules.d/99-cws-uhid.rules` 應與原始碼中的規則相同。要開啟 `/dev/uhid`，帳戶仍須屬於 `plugdev`，並重新登入。完整的 HID 連線還需要手機正在藍牙廣播。只檢查安裝包，並不能證明桌面登入之後可以開啟 `/dev/uhid`。

不帶參數執行 `bash apps/proxy/linux/check-deb.sh` 會組建一個結構檢查用的 `.deb`。當中的 Node 二進位檔與原生附加元件只是 ELF 佔位檔。它只供在無法編譯 Linux 附加元件的機器上檢查安裝包結構。請勿安裝。

套件不含種子、金鑰庫或描述檔。種子並非絕對安全。

Windows 仍然沒有安裝包。Windows 沒有虛擬 HID。

在 macOS，虛擬 HID 是已簽署的 CWS Proxy 應用程式，不是 `yarn proxy`：

```bash
yarn workspace @cws/proxy app
```

產品版本 **1.1.2** 與組建編號 **8** 來自 `apps/mobile/app.json` 的 `version`、`versionCode` 及 `buildNumber`。Expo prebuild 會寫入 Android 的 `versionName`／`versionCode`，以及 iOS 的 `CFBundleShortVersionString`／`CFBundleVersion`。隨應用程式發行的工作區套件版本同為 `1.1.2`。macOS 代理程式的行銷版本與組建編號相同。

## 協議範圍

### 裝置型號

| 品牌 | 型號 | 手機傳輸 |
| --- | --- | --- |
| Ledger | Nano X、Flex、Stax、Nano Gen5 | 藍牙 APDU |
| Trezor | Safe 7 | 藍牙 THP |
| OneKey | Classic、Classic 1s、Pure、Touch、Pro（V1）；Pro 2、Neo（V2） | 藍牙 protobuf |

OneKey Mini 沒有藍牙，本軟件不予模擬。

### 其他傳輸

| 傳輸 | 本版本的行為 |
| --- | --- |
| USB HID | macOS 的 CWS Proxy（虛擬 HID），或 Linux 的 Ubuntu 套件 `cws-proxy` 或 `yarn proxy`（`uhid`），把報告經藍牙轉送至手機。沒有 APDU 允許清單。你在 Chrome 授權的網站可以發送手機已實現的任何指令。Phantom 仍可能無法完成解鎖。 |
| Trezor Bridge | 代理程式可在 `http://127.0.0.1:21325` 回應，供相容主機列舉裝置。橋接器會反映請求的 `Origin`。 |
| 二維碼 | 以 UR 及 BBQr 匯出帳戶金鑰與輸出描述符。備份種子二維碼必須經手機確認後才會產生。 |

應用程式按格式提示的掃描對象：

| 格式 | 應用程式指示的掃描位置 |
| --- | --- |
| 帳戶 UR（Keystone 一類及其同系格式） | Rabby、MetaMask |
| 以太坊多帳戶 UR | OKX。Rabby 與 MetaMask 會拒絕此格式。 |
| 比特幣帳戶 | Sparrow 或 BlueWallet，作只供查看的匯入 |
| 比特幣輸出描述符 | Sparrow |
| BBQr xpub | Sparrow，作 Coldcard 二維碼匯入 |
| 備份種子 | 必須先在手機確認。該碼包含秘密資料。 |

指名的主機仍可能掃不到，或無法完成某個畫面。見〈已知的主機缺口〉。

### 鏈

預設路徑在 `packages/contracts`。主機可以要求其他路徑。這些鏈有簽署與地址匯出。能夠開啟 Ledger 應用程式名稱，並不表示每個主機的每個畫面均已完成。

| 鏈 | 預設路徑 |
| --- | --- |
| 比特幣傳統 | `m/44'/0'/0'/0/0` |
| 比特幣巢狀 SegWit | `m/49'/0'/0'/0/0` |
| 比特幣原生 SegWit | `m/84'/0'/0'/0/0` |
| 比特幣 Taproot | `m/86'/0'/0'/0/0` |
| 以太坊及 EVM 路徑 | `m/44'/60'/0'/0/0` |
| Avalanche X/P | `m/44'/9000'/0'/0/0` |
| Solana（Ledger） | `m/44'/501'/0'` |
| Solana（Phantom） | `m/44'/501'/0'/0'` |
| Cosmos | `m/44'/118'/0'/0/0` |
| Tron | `m/44'/195'/0'/0/0` |
| XRP | `m/44'/144'/0'/0/0` |
| Cardano | `m/1852'/1815'/0'/0/0` |
| Polkadot | `m/44'/354'/0'/0'/0'` |
| TON | `m/44'/607'/0'/0'/0'/0'` |
| Aptos | `m/44'/637'/0'/0'/0'` |
| Sui | `m/44'/784'/0'/0'/0'` |
| NEAR | `m/44'/397'/0'/0'/1'` |
| 萊特幣 | `m/84'/2'/0'/0/0` |
| 狗狗幣 | `m/44'/3'/0'/0/0` |
| Stellar | `m/44'/148'/0'` |
| Tezos | `m/44'/1729'/0'` |
| BNB Beacon | `m/44'/714'/0'/0/0` |

萊特幣與狗狗幣使用比特幣處理程式。軟件附有 Ledger 應用程式目錄，供主機開啟應用程式名稱，當中包括沒有專用簽署處理程式的名稱。那些名稱會視為未知族系。

設定 → Ledger 目錄可為每個應用程式選擇一個已發布版本。主機向已開啟應用程式查詢版本時，讀到的就是這個版本。CWS 不會因此改用該舊版程式的指令。更新 Ledger 應用程式會按目前選擇的裝置，從 Ledger 公開目錄重新載入名稱與版本。尚未更新時，清單是此組建內置、對應該裝置的目錄。

交易簽署、訊息簽署及備份種子匯出，須在手機上長按確認；正式組建另須通過作業系統認證。公開帳戶或擴展公鑰的讀取亦須確認。一次確認涵蓋該次讀取，以及其後 60 秒內的 15 次公開讀取。它不會簽署。手機廣播期間，裝置畫面會說明已連線的主機可以衍生地址。

## 保安摘要

秘密資料以 `WHEN_UNLOCKED_THIS_DEVICE_ONLY` 儲存。正式組建另設定 `requireAuthentication`。助記詞不會寫入剪貼簿。匯入只在確認貼上之後才讀取剪貼簿。正式組建在顯示、匯入、儲存、簽署及匯出種子之前，會要求作業系統認證。Android 正式組建在秘密畫面設定 `FLAG_SECURE`。這些略過只在 `__DEV__` 為真時存在。

這不是硬體錢包級安全。種子不是硬體錢包級安全。1.1.2 仍保留的相容選擇：

- WebHID 轉送報告時沒有指令允許清單。
- 本機 trezord 橋接器聽 `127.0.0.1`，並反映請求的 `Origin`。
- iOS 在系統報告截圖時顯示警告，不會把即時畫面塗黑。只警告是有意的，因為塗黑亦會塗黑鏡像輸出。
- iOS 不提供 BLE 連結金鑰。

能夠解鎖手機、除錯行程、拍攝螢幕或連上主機的人，所能取得的資料多於介面所顯示。全文見 [security.md](security.md)。1.1.2 說明見 [releases/1.1.2.md](releases/1.1.2.md)。

## 保安模型

本節與 [security.md](security.md) 同一要旨。

### 軟件實際做的事

- 新的 BIP39 或 SLIP-39 秘密資料來自作業系統的密碼學安全隨機數。助記詞與份額只在畫面上顯示，以便抄寫，不會寫入剪貼簿。輸入助記詞、份額、熵、核對詞或密語的欄位已關閉系統複製選單。匯入時仍可按「貼上」讀取剪貼簿。
- 儲存的是熵（或 SLIP-39 秘密），使用 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`。網頁組建拒絕寫入。密語只存在於該工作階段的記憶體，鎖定時清除。
- 正式組建在顯示、匯入、儲存或套用密語之前，以及在簽署或匯出備份種子二維碼之前，會要求作業系統認證（生物識別或裝置密碼）。除錯組建略過顯示時的提示，以便實驗室操作。除錯組建的簽署與種子匯出依設定開關；正式組建即使關閉該開關仍會詢問。
- 種子庫、匯入、產生、密語表、備份種子二維碼及種子匯出確認均為秘密畫面。Android 正式組建在這些畫面設定 `FLAG_SECURE`。Android 除錯組建不設定，以便品質檢查截圖。iOS 會模糊應用程式切換器，並在系統報告截圖時顯示警告。iOS 不會把即時畫面塗黑。
- 已遮罩的密語欄位只向無障礙功能提供欄位名稱，不提供秘密本身。可見的助記詞仍留在無障礙樹，以便抄寫。秘密畫面開啟時，螢幕閱讀器可以讀出這些詞語。

### 為相容而保留的風險

以下項目若關閉，真實錢包將無法連線或無法列出帳戶。這些是殘餘風險。1.1.0 並不宣稱已消除它們。

**WebHID。** 代理程式把 HID 報告原樣轉成 APDU，沒有指令允許清單。你在 Chrome 授權的網站可以發送手機已實現的任何指令，包括靜默讀取地址或擴展公鑰。簽署與種子匯出仍須手機確認。

**trezord。** 橋接器只聽 `127.0.0.1`，並反映請求的 `Origin`（沒有 Origin 時為 `*`）。Trezor 相容主機需要此行為。代理程式運行時，同一部電腦上的瀏覽器來源都可以呼叫橋接器。簽署仍須在手機確認。

**靜默公鑰匯出。** 以太坊 `GET_ADDRESS` 在 P1=0、Solana 公鑰在 P1=0、比特幣擴展公鑰，以及其他應用程式的同類指令，均不逐筆確認。若指令包含鏈碼，主機可以繼續衍生公開子金鑰。這不是種子。若每個帳戶都要確認，上述錢包不會完成列出帳戶。顯示地址（P1=1）仍會確認。手機廣播期間，裝置畫面會說明已連線的主機可以衍生地址。

**並非每次讀取都要求生物識別。** 熵項目沒有設定 `requireAuthentication`。該 API 會在每次讀取時提示，而主機列出帳戶時程式必須讀取熵。該提示會中斷列出帳戶，並在 iPhone 鏡像輸出下失敗。裝置解鎖後，應用程式行程可以讀取該項目，而不再詢問生物識別。工作階段解鎖，以及正式組建的顯示與簽署提示，是應用程式層的檢查，不是鑰匙圈存取控制。

### 平台限制

- **iOS 截圖。** 若呼叫系統的擷取阻擋，畫面在鏡像輸出或控制中心擷取時會被塗黑。CWS 不這樣做。另一部相機仍可拍下螢幕。程式沒有輪詢擷取狀態。
- **iOS 藍牙鏈路金鑰。** 作業系統不提供該金鑰。沒有鏈路金鑰時，簽署仍須確認主機。iOS 上的連線並不綁定作業系統的配對金鑰。
- **除錯組建。** `SYSTEM_ALERT_WINDOW` 不在除錯清單，亦不在正式清單。除錯組建仍允許明文流量，以便 Metro 載入套件。正式組建不會合併除錯清單。截圖監聽使用 `DETECT_SCREEN_CAPTURE`，這不是浮動視窗權限。
- **正式簽署。** Play 上架組建由發行者的環境簽署。本版本庫沒有金鑰庫，亦沒有上載密碼。該設定缺席時，正式包裝會失敗，而不會改用除錯金鑰。除錯手機不能證明正式組建的認證提示。

### 已知的主機缺口

下列行為在 1.1.0 並未完成。它們是可用性缺口，不是放寬靜默列出帳戶的理由。

- Phantom 連線後可能無法完成解鎖。
- 在部分環境，Rabby 的相機可能無法掃到手機二維碼。
- Avalanche Core 可能無法完整列出 Avalanche X 與 P 帳戶。
- OKX 可能無法顯示已匯入帳戶的資產餘額。

地址匯出與簽署表由 [testing.md](testing.md) 所述的自動測試涵蓋。不應期望 Ledger Live 的正品檢查通過。CWS 不是 Ledger Live、Trezor Suite 或 OneKey 應用程式。

讀者應假設：能夠解鎖手機、除錯行程、拍攝螢幕或連上主機的人，所能取得的資料多於介面所顯示。任何在此輸入的秘密資料，均應視為已不適合用於重要用途。

## 測試紀錄

本節與 [testing.md](testing.md) 同一要旨。1.1.0（組建編號 6）發布的是 main 上的程式，連同版本號、公開文件，以及從版本庫移除本機簽署身份。它本身沒有另一次實機驗收。使用者報告的 near.com、Core、Rabby 與 app.rhea.finance 會話見〈第三方主機〉。

自動測試：

- `yarn test` 運行工作區的 Vitest：協議處理、二維碼、種子庫、拒絕剪貼簿、秘密畫面計數、正式組建重新認證政策，以及代理程式。
- `yarn workspace @cws/proxy test:e2e` 以 Playwright 測試代理程式頁面。在 `apps/proxy` 內同一套件是 `yarn test:e2e`。
- `apps/mobile/.maestro` 與 `apps/proxy/.maestro` 的 Maestro 流程驅動手機介面與代理程式外殼。這些流程不作藍牙廣播。Java 須在 `PATH`。

綠色結果是本版本庫的回歸門檻。它不是每家第三方錢包畫面都已通過的證明，亦不是種子安全的聲明。

2026 年 10 月曾在一部 Android 16 手機安裝當時的除錯組建（`versionName` 1.0.4，即本版本所發佈的程式）。該次檢查確認：

- 該除錯 APK 的 `aapt dump permissions` 沒有列出 `SYSTEM_ALERT_WINDOW`，套件傾印亦不再顯示已授予。APK 有聲明藍牙（包括廣播與連線）、相機、`DETECT_SCREEN_CAPTURE`、`INTERNET`、`USE_BIOMETRIC` 及 `USE_FINGERPRINT`。
- 匯入畫面的助記詞欄為空。長按出現游標與鍵盤，沒有出現系統複製選單。畫面上的「貼上」仍然存在。無障礙節點的內容描述為空，文字是佔位提示。
- 在該畫面做系統截圖後，Android 報告 CWS 已偵測到截圖。除錯組建仍允許擷取，這是預期行為。正式組建的 `FLAG_SECURE` 沒有安裝：Play 上架簽署未設定，該次檢查亦沒有建立金鑰庫。

空白匯入畫面、長按及截圖提示的截圖在 [testing/](testing/)（英文紀錄所連結的三張圖）。圖中沒有助記詞、份額或密語。

可安裝的 amd64 與 arm64 `.deb` 曾在 Ubuntu 容器內以 `apt` 安裝。`dpkg-deb` 接受這兩個檔案，`cws-proxy --help` 印出用法，本機頁面有回應，udev 規則與原始碼相同，`/etc/modules-load.d/cws-proxy.conf` 內容是 `uhid`。arm64 套件在 Ubuntu 24.04 與 22.04 安裝；22.04 上移除套件後，該規則與 modules-load 檔一併刪除。amd64 套件在 Ubuntu 24.04 安裝。這些容器的核心沒有 `uhid` 模組，亦沒有 udev 守護行程，所以 `modprobe` 與 `udevadm` 在那裡沒有成功，安裝仍然完成。該次沒有開啟 `/dev/uhid`，沒有桌面登入，亦沒有連接手機。

### 第三方主機

2026 年 10 月有四次使用者報告的實機會話。每一列只記錄該主機在該路徑上的結果。種子並非絕對安全。見 [security.md](security.md)。此頁沒有記錄各次使用的秘密資料。

| 主機 | 路徑 | 報告結果 |
| --- | --- | --- |
| near.com | Ledger 藍牙（BLE） | 登入成功。一筆交易成功。 |
| Core（core.app） | CWS Proxy（主機側為有線），Ledger 身份 | Avalanche C 鏈 → X 鏈 → P 鏈 → X 鏈 → C 鏈的匯出／匯入來回成功。 |
| Rabby Wallet，於 lfj.gg（Trader Joe / LFJ） | CWS Proxy（主機側為有線），Ledger 身份 | lfj.gg 一筆交易成功。 |
| app.rhea.finance（Rhea Finance） | CWS iPhone 上的 Ledger 藍牙（BLE） | 登入成功。一筆交易成功。 |

near.com 的手機是一部 iPhone，運行 1.1.0（組建編號 6）。該程式包含 Near 簽署訊息表，以及 Ledger 目錄的版本選擇。手機以 Ledger 裝置經藍牙廣播。near.com 完成登入，並完成一筆交易。

Core 經 CWS Proxy 連接，使用的是 CWS 的 Ledger 身份。此報告的主機路徑是代理程式。Core 按上表順序完成 C 鏈、X 鏈與 P 鏈之間的匯出／匯入來回。此列記錄 core.app 在 CWS Proxy 上的該序列。其他 Avalanche 主機不在此報告內。另一項缺口仍然保留：Avalanche Core 可能無法完整列出 X 與 P 帳戶。見下列清單及 [security.md](security.md)。

Rabby Wallet（瀏覽器擴充功能）在 lfj.gg（Trader Joe / LFJ）簽署一筆交易。手機是一部 iPhone，運行 1.1.0（組建編號 6），該次是在提交 0fbbf4c（#43）之後。裝置路徑與 Core 一列相同：CWS 的 Ledger 身份經 CWS Proxy 連接，主機側為有線 HID，報告經藍牙轉送至手機。報告者表示該筆交易成功（「成功係 lfj.gg 交易」）。在該提交之前，這條路徑會停住，確認表沒有打開：尚未結束的以太坊 SIGN 分塊（e0/04）沒有 ACK。此列是該 ACK 之後報告的成功，只記錄 Rabby 在 lfj.gg 經 CWS Proxy 的該筆交易。其他交易所，以及不經代理程式、Rabby 直接以藍牙連接的會話，不在此報告內。Rabby 相機掃描的缺口仍然保留。見下列清單及 [security.md](security.md)。

app.rhea.finance（Rhea Finance）經 Ledger 藍牙連接一部運行 CWS 的 iPhone。此報告的主機路徑是該藍牙會話。登入成功，並完成一筆交易。報告者表示登入與該筆交易成功（「成功用 ledger 藍牙登入及交易成功」）。此列只記錄 app.rhea.finance 經 Ledger 藍牙的該次登入與該筆交易。CWS Proxy 不在此報告內。其他 Near 主機與其他 DEX 主機不在此報告內。種子並非絕對安全。見 [security.md](security.md)。

下列項目沒有在 1.1.0 的實機上測試，亦沒有宣稱完成：

- 正式組建的作業系統認證提示沒有在裝置上顯示。
- 本版本說明沒有在 iOS 裝置上重測截圖行為。iOS 限制見〈平台限制〉。
- Phantom 解鎖、Rabby 相機掃描、Avalanche Core 的 X／P 列出，以及 OKX 資產顯示，均未結束。見〈已知的主機缺口〉。
- 自動測試、2026 年 10 月的 Android 實機檢查，以及 Ubuntu 安裝包檢查，均沒有使用掌管真實資金的秘密資料。請勿加入。

## 文件

| 文件 | 內容 |
| --- | --- |
| [../README.md](../README.md) | 英文公開首頁 |
| [security.md](security.md) | 英文保安說明 |
| [testing.md](testing.md) | 英文測試紀錄 |
| [releases/1.1.2.md](releases/1.1.2.md) | 1.1.2（組建編號 8）的雙語發行說明 |
| [releases/1.1.1.md](releases/1.1.1.md) | 1.1.1（組建編號 7）熱錢包基線的雙語發行說明 |
| [releases/1.1.0.md](releases/1.1.0.md) | 1.1.0（組建編號 6）雙語發行說明 |
| [store/README.md](store/README.md) | Mac App Store 截圖索引 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 工程結構 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 貢獻、測試，以及不應提交的秘密資料 |
| [../LICENSE](../LICENSE) | 版權屬 YSK Limited，保留所有權利 |

## 授權

版權 © 2026 YSK Limited，保留所有權利。

公開原始碼是為了讓人閱讀行為與保安限制。除此以外不授予其他許可。本軟件不適合作保管真實數碼資產。不得把本軟件表述為 Ledger、Trezor、OneKey 或任何其他錢包供應商的產品。見 [../LICENSE](../LICENSE)。
