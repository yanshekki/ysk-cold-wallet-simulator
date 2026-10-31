# Build CWS Proxy on macOS

**YSK Limited** · [ysk.hk/products/ysk-cold-wallet-simulator](https://ysk.hk/products/ysk-cold-wallet-simulator)

CWS Proxy bundle `hk.ysk.cws.proxy` · version **1.1.4 (build 10)**

Seeds are not absolutely safe. The proxy forwards bytes. Signing stays on the phone. Read [security.md](security.md) before you use a secret.

## What this builds

A local **Debug** `CWS Proxy.app` for Apple silicon. On macOS, virtual HID is this signed app.

`yarn proxy` starts the Node daemon. It does not create a macOS virtual HID device. `apps/proxy/src/main.ts` says the same thing.

## Not on the Mac App Store

The Mac App Store listing is coming soon. The HID Virtual Device App Store entitlement is still **Submitted**. This page is the from-source path until that listing exists. This repository does not publish a Mac App Store installer URL.

Screenshot sets for that submission live in [store/cws-proxy-macos/README.md](store/cws-proxy-macos/README.md). They are not a packaged build.

## Prerequisites

- An Apple silicon Mac. `apps/proxy/macos/xcode-app.sh` sets `ARCHS=arm64` and `ONLY_ACTIVE_ARCH=YES`.
- The Xcode project’s deployment target is macOS 13.0.
- Full Xcode. The script sets `DEVELOPER_DIR` to `/Applications/Xcode.app/Contents/Developer` unless you have already set `DEVELOPER_DIR`.
- Node.js on `PATH`, 22 or newer. The Ubuntu package pins Node.js 24.22.2. This macOS script does not. `apps/proxy/macos/CWSProxy/bundle-proxy.sh` copies whichever `node` it finds into the app.
- `python3`. The bundle script uses it to resolve the real Node binary.
- Yarn 1.22.22, the `packageManager` in the root `package.json`, via Corepack.
- Rust and Cargo. `yarn workspace @cws/native-proxy build` runs `napi build --platform --release`. There is no `rust-toolchain` file.
- A `yarn` install at the repo root, so `node_modules/esbuild` exists. The bundle script stops if esbuild is missing.
- Apple signing for the team already set in the Xcode project (`DEVELOPMENT_TEAM` `K897VVZW77`) when you build the committed project. Signing style is Automatic. Hardened runtime is on. A fork replaces that team. See [CONTRIBUTING.md](../CONTRIBUTING.md). Do not commit a provisioning profile, a certificate, or a password. `CWS_CODESIGN_IDENTITY` is an optional override in `xcode-app.sh`.
- The app entitlement file `apps/proxy/macos/CWSProxy/CWSProxy/CWSProxy.entitlements` includes `com.apple.developer.hid.virtual.device`. Virtual HID needs that entitlement. If signing fails, the failure is the Apple team or the entitlement. `yarn proxy` is not a substitute on macOS.

## Commands

From the repository root:

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
yarn workspace @cws/native-proxy build
yarn workspace @cws/proxy app
open "apps/proxy/macos/CWSProxy/DerivedData/Build/Products/Debug/CWS Proxy.app"
```

`yarn workspace @cws/proxy app` is `bash macos/xcode-app.sh` from `apps/proxy` (`apps/proxy/package.json`). The same script directly:

```bash
bash apps/proxy/macos/xcode-app.sh
```

The script changes to `apps/proxy` and runs `xcodebuild` on `macos/CWSProxy/CWSProxy.xcodeproj`, scheme `CWS Proxy`, configuration **Debug**, destination `generic/platform=macOS`, derived data `macos/CWSProxy/DerivedData`.

The shared scheme is `apps/proxy/macos/CWSProxy/CWSProxy.xcodeproj/xcshareddata/xcschemes/CWS Proxy.xcscheme`. Its Archive action is Release. No yarn script archives or notarizes.

The Xcode run script calls `$SRCROOT/bundle-proxy.sh`. `SRCROOT` is `apps/proxy/macos/CWSProxy`, so the file is `apps/proxy/macos/CWSProxy/bundle-proxy.sh`. That script:

- copies the `node` binary from `PATH` into the app
- bundles `apps/proxy/src/main.ts` with esbuild to `proxy/main.cjs`, externalising `@cws/native-proxy`
- copies `packages/native-proxy` (`index.js`, `package.json`, and every `*.node`)
- copies `apps/proxy/ui/*`
- codesigns the bundled Node binary and the native addon when Xcode provides an identity

If `packages/native-proxy` has no `*.node`, the script exits and tells you to run `yarn workspace @cws/native-proxy build`.

## Where the app is

```text
apps/proxy/macos/CWSProxy/DerivedData/Build/Products/Debug/CWS Proxy.app
```

`apps/proxy/macos/CWSProxy/DerivedData/` is gitignored. Cleaning Derived Data deletes this build.

Bundle id `hk.ysk.cws.proxy`. Display name CWS Proxy. `Info.plist` is `apps/proxy/macos/CWSProxy/CWSProxy/Info.plist`. Marketing version 1.1.4 and build 10 come from the Xcode project, matching `apps/mobile/app.json`.

## Applications

The build script does not copy the app to `/Applications`. `/Applications` appears in `xcode-app.sh` only as the default location of Xcode.

To keep the app after a Derived Data clean, copy it yourself:

```bash
cp -R "apps/proxy/macos/CWSProxy/DerivedData/Build/Products/Debug/CWS Proxy.app" /Applications/
open "/Applications/CWS Proxy.app"
```

System Settings → Privacy & Security → Bluetooth must allow that copy of CWS Proxy.

## How it runs

The window is a WebKit view of the proxy page. `ProxySession.swift` fixes `uiPort` at **8788**. `NodeProcess.swift` starts the bundled proxy with `--ui-port 8788` and `CWS_NO_OPEN=1`. `ContentView.swift` loads `http://127.0.0.1:8788/?native=1`.

A browser on the same machine can open `http://127.0.0.1:8788`.

The `--ui-port` flag belongs to `cws-proxy` and `yarn proxy`, the Linux and Windows daemon. Changing it does not retarget this macOS app.

## First session

Press Start. The page lists nearby CWS phones: advertised name, Bluetooth id, and RSSI when the operating system reports it. Choose one phone. The proxy locks to that id until you press Unlock / Change device.

The lock file is `~/Library/Application Support/CWS Proxy/ble-lock.json`. It stores the Bluetooth id and the advertised name, not a seed. If the phone changes its address, or macOS issues a new peripheral id, pick the phone again.

With no lock file, `cws-proxy --no-ui` still connects to the highest-ranked advertiser. The macOS app uses the page, not `--no-ui`.

The proxy only forwards bytes. Signing stays on the phone. Seeds are not absolutely safe.

## What this build is not

- It is not a Mac App Store archive, and it is not a notarized Release upload.
- It is not the Ubuntu package. That path is `yarn workspace @cws/proxy deb`, which runs `bash apps/proxy/linux/build-deb.sh`.
- It is not `apps/proxy/macos/pack.sh`. That script writes `apps/proxy/dist/CWS Proxy.app` and requires `CWS_CODESIGN_IDENTITY` and `CWS_PROFILE`. It is a separate packager. `yarn workspace @cws/proxy app` does not run it.

## Related pages

- [security.md](security.md)
- [store/README.md](store/README.md)
- [releases/1.1.4.md](releases/1.1.4.md)
- [../README.md](../README.md)

## 繁體中文（香港）

**YSK Limited** · [ysk.hk/products/ysk-cold-wallet-simulator](https://ysk.hk/products/ysk-cold-wallet-simulator)

CWS Proxy 套件識別碼 `hk.ysk.cws.proxy` · 版本 **1.1.4（組建編號 10）**

種子並非絕對安全。代理程式只轉送位元組。簽署留在手機上。使用秘密資料之前，請先閱讀 [security.md](security.md)。

### 這個指令組建甚麼

一個給 Apple silicon 使用的本機 **Debug** `CWS Proxy.app`。在 macOS，虛擬 HID 是這個已簽署的應用程式。

`yarn proxy` 啟動的是 Node 守護行程。它不會建立 macOS 虛擬 HID 裝置。`apps/proxy/src/main.ts` 亦如此說明。

### 尚未在 Mac App Store

Mac App Store 即將推出。HID Virtual Device 的 App Store entitlement 仍是 **Submitted**，尚未獲批。在該上架出現之前，本頁是從原始碼組建的路徑。本版本庫沒有公布 Mac App Store 安裝檔網址。

該次提交用的截圖在 [store/cws-proxy-macos/README.md](store/cws-proxy-macos/README.md)。那些圖不是已封裝的組建。

### 所需環境

- Apple silicon Mac。`apps/proxy/macos/xcode-app.sh` 設定 `ARCHS=arm64` 及 `ONLY_ACTIVE_ARCH=YES`。
- Xcode 專案的部署目標是 macOS 13.0。
- 完整的 Xcode。除非你已設定 `DEVELOPER_DIR`，指令稿會把 `DEVELOPER_DIR` 設為 `/Applications/Xcode.app/Contents/Developer`。
- `PATH` 上有 Node.js，22 或更新。Ubuntu 套件固定使用 Node.js 24.22.2。這條 macOS 指令稿沒有固定版本。`apps/proxy/macos/CWSProxy/bundle-proxy.sh` 會把找到的那個 `node` 複製進應用程式。
- `python3`。打包指令稿用它解析 Node 二進位檔的真實路徑。
- Yarn 1.22.22，即根目錄 `package.json` 的 `packageManager`，經 Corepack 啟用。
- 在版本庫根目錄執行過 `yarn`，使 `node_modules/esbuild` 存在。找不到 esbuild 時，打包指令稿會停止。
- Rust 與 Cargo。`yarn workspace @cws/native-proxy build` 執行 `napi build --platform --release`。版本庫沒有 `rust-toolchain` 檔。
- 組建版本庫內的專案時，使用 Xcode 專案已設定的團隊（`DEVELOPMENT_TEAM` 為 `K897VVZW77`）。簽署方式是 Automatic，並開啟 hardened runtime。分叉若自行簽署，須更換該團隊。見 [CONTRIBUTING.md](../CONTRIBUTING.md)。請勿提交描述檔、證書或密碼。`CWS_CODESIGN_IDENTITY` 是 `xcode-app.sh` 的可選覆蓋。
- 權限檔 `apps/proxy/macos/CWSProxy/CWSProxy/CWSProxy.entitlements` 包含 `com.apple.developer.hid.virtual.device`。虛擬 HID 需要這項 entitlement。若簽署失敗，原因是 Apple 團隊或該 entitlement。在 macOS 上，`yarn proxy` 不能代替這個應用程式。

### 指令

在版本庫根目錄：

```bash
corepack enable && corepack prepare yarn@1.22.22 --activate
yarn
yarn workspace @cws/native-proxy build
yarn workspace @cws/proxy app
open "apps/proxy/macos/CWSProxy/DerivedData/Build/Products/Debug/CWS Proxy.app"
```

`yarn workspace @cws/proxy app` 即 `apps/proxy/package.json` 裡的 `bash macos/xcode-app.sh`。直接執行同一指令稿：

```bash
bash apps/proxy/macos/xcode-app.sh
```

指令稿會進入 `apps/proxy`，對 `macos/CWSProxy/CWSProxy.xcodeproj` 執行 `xcodebuild`，scheme 是 `CWS Proxy`，組態是 **Debug**，目標是 `generic/platform=macOS`，derived data 是 `macos/CWSProxy/DerivedData`。

共享 scheme 在 `apps/proxy/macos/CWSProxy/CWSProxy.xcodeproj/xcshareddata/xcschemes/CWS Proxy.xcscheme`。它的 Archive 動作是 Release。沒有 yarn 指令稿會封存或公證。

Xcode 的 run script 呼叫 `$SRCROOT/bundle-proxy.sh`。`SRCROOT` 是 `apps/proxy/macos/CWSProxy`，所以檔案是 `apps/proxy/macos/CWSProxy/bundle-proxy.sh`。該指令稿會：

- 把 `PATH` 上的 `node` 複製進應用程式
- 用 esbuild 把 `apps/proxy/src/main.ts` 打包成 `proxy/main.cjs`，並把 `@cws/native-proxy` 留在套件之外
- 複製 `packages/native-proxy`（`index.js`、`package.json`，以及每一個 `*.node`）
- 複製 `apps/proxy/ui/*`
- 當 Xcode 提供簽署身份時，簽署內置的 Node 二進位檔與原生附加元件

若 `packages/native-proxy` 沒有 `*.node`，指令稿會停止，並提示先執行 `yarn workspace @cws/native-proxy build`。

### 應用程式的位置

```text
apps/proxy/macos/CWSProxy/DerivedData/Build/Products/Debug/CWS Proxy.app
```

`apps/proxy/macos/CWSProxy/DerivedData/` 已列入 gitignore。清除 Derived Data 會刪除這個組建。

套件識別碼 `hk.ysk.cws.proxy`。顯示名稱 CWS Proxy。`Info.plist` 是 `apps/proxy/macos/CWSProxy/CWSProxy/Info.plist`。行銷版本 1.1.4 與組建編號 10 來自 Xcode 專案，與 `apps/mobile/app.json` 相同。

### 「應用程式」資料夾

組建指令稿不會把應用程式複製到 `/Applications`。`xcode-app.sh` 提到 `/Applications`，只是因為 Xcode 的預設位置在那裡。

若要在清除 Derived Data 之後仍保留應用程式，請自行複製：

```bash
cp -R "apps/proxy/macos/CWSProxy/DerivedData/Build/Products/Debug/CWS Proxy.app" /Applications/
open "/Applications/CWS Proxy.app"
```

系統設定 → 私隱與保安 → 藍牙必須允許這一份 CWS Proxy。

### 如何運行

視窗是代理程式頁面的 WebKit 檢視。`ProxySession.swift` 把 `uiPort` 固定為 **8788**。`NodeProcess.swift` 以 `--ui-port 8788` 及 `CWS_NO_OPEN=1` 啟動內置代理程式。`ContentView.swift` 載入 `http://127.0.0.1:8788/?native=1`。

同一部電腦上的瀏覽器可以開啟 `http://127.0.0.1:8788`。

`--ui-port` 屬於 `cws-proxy` 與 `yarn proxy`，亦即 Linux 與 Windows 的守護行程。改這個旗標不會改到這個 macOS 應用程式。

### 第一次使用

按下 Start。頁面列出附近的 CWS 電話：廣播名稱、藍牙識別碼，以及作業系統有提供時的 RSSI。選擇一部電話。在你按下解除鎖定／變更裝置之前，代理程式會鎖定該識別碼。

鎖定檔是 `~/Library/Application Support/CWS Proxy/ble-lock.json`。它只記藍牙識別碼與廣播名稱，不含種子。若電話更換位址，或 macOS 發出新的周邊識別碼，請再選一次。

沒有鎖定檔時，`cws-proxy --no-ui` 仍會連接排名最高的廣播。macOS 應用程式使用頁面，不用 `--no-ui`。

代理程式只轉送位元組。簽署留在手機上。種子並非絕對安全。

### 這個組建不是甚麼

- 它不是 Mac App Store 封存，也不是已公證的 Release 上載。
- 它不是 Ubuntu 套件。那條路徑是 `yarn workspace @cws/proxy deb`，亦即 `bash apps/proxy/linux/build-deb.sh`。
- 它不是 `apps/proxy/macos/pack.sh`。該指令稿寫出 `apps/proxy/dist/CWS Proxy.app`，並要求環境變數 `CWS_CODESIGN_IDENTITY` 與 `CWS_PROFILE`。它是另一個打包程式。`yarn workspace @cws/proxy app` 不會執行它。

### 相關頁面

- [security.md](security.md)
- [store/README.md](store/README.md)
- [releases/1.1.4.md](releases/1.1.4.md)
- [../README.md](../README.md)
