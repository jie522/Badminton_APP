# BADMAP 羽球管理 APP — 開發準則

這個 repo 是一個給自己球隊用的純靜態網頁 App(vanilla JS,無框架、無建置流程),
架構沿用 [FAMIAP](../260713%20Family%20APP):`index.html` + `css/style.css` + `js/*.js`,
資料存 localStorage,啟用同步後鏡像到使用者自己的 Google Sheet / Drive(`apps-script/Code.gs`)。

## 前端規範

- **字體**:全站統一 **Noto Sans TC(思源黑體)**,透過 Google Fonts 載入,`body { font-family }` 已設好,新增元件不要另外指定字體。
- **顏色**:只用 `css/style.css` 開頭 `:root` 定義的變數(`--accent`、`--in` 收入綠、`--out` 支出紅…),深色模式的對應值在 `@media (prefers-color-scheme: dark)` 裡,新增顏色要兩邊都補。
- **快取破壞(cache-busting)**:`index.html` 引用 `css/style.css`、`js/*.js` 都帶 `?v=YYYYMMDD`。**每次改到 CSS 或 JS 就把 `index.html` 裡所有 `?v=` 一起換成當天日期**(同一天再改就加尾碼,例如 `20260818b`),不然球友手機會因為快取看不到新版。
  **同一次還要改 `sw.js`**:把 `CACHE` 的版本字串換成一樣的日期,並把 `ASSETS` 裡的 `?v=` 跟著換。Service Worker 是 network-first(有網路一定拿最新的),但 `CACHE` 沒換的話舊快取不會被清掉,離線時會看到舊版。
- **共用 UI 工具在 `js/ui.js`**:主題(`Theme`)、App 內確認彈窗(`ask()`,取代 `confirm()`)、名字頭像(`avatarHtml()`)、震動回饋(`haptic()`)、進度環(`ringHtml()`)。這支要排在 `store.js` 之後、其他模組之前載入。
- **手機優先**:所有版面以 375px 寬為基準設計,`main` 最大寬 720px 置中;可點的東西高度至少 38px。
- **不要引入框架或 npm 套件**,保持「clone 下來用瀏覽器打開就能跑」。

## 資料模型(js/store.js 開頭有完整註解)

六張表:`members`(球員)、`seasons`(季別)、`payments`(季費繳納)、`sessions`(場次)、`shuttles`(羽球品項)、`txns`(手動帳目)。
`settings` 是裝置設定,**不同步**。

新增欄位時三個地方要一起改,少一個資料就會在同步時掉:

1. `js/store.js` 開頭的資料表註解
2. `apps-script/Code.gs` 的 `TABLES` 定義(`fields` + `headers`,必要時 `extras` 人看的欄位)
3. 若是陣列/物件欄位,加進 `Code.gs` 的 `JSON_FIELDS`;數字加進 `NUM_FIELDS`;日期加進 `DATE_FIELDS` 和 `TEXT_FIELDS`;布林欄位加進 `BOOL_FIELDS`,**空白時該視為 true 的才加進 `BOOL_DEFAULT_TRUE`**(`active` 是,`current` 不是)

舊資料的欄位補齊寫在 `js/store.js` 的 `migrate()`,啟動時跑一次;新增有預設值的欄位時記得一起補。

改完 `Code.gs` 要把 `VERSION` +1,並提醒使用者到 Apps Script「管理部署作業 → 新版本」重新部署,否則線上跑的還是舊版。

## 記帳規則(改動前務必先讀)

- **季打球員**:繳固定季費,場地費由公款支付,**每場不再收錢**。季費只記「已繳 / 未繳」,不逐場扣款。
- **臨打球友**:每場收一次單場費,**金額依性別**(`guestFeeOf(member)` → `cfg().guestFeeM` / `guestFeeF`,預設男 180 / 女 160),可個別調金額、標記已收 / 未收。性別欄位缺漏時 `genderOf()` 一律當男生算,不要讓缺欄位變成收不到錢。
- **每場公款進出** = 臨打收入 − 場地費。
- **球費不進每場現金流**:買球的錢在「收支」頁記買球那筆時就已經付出去了,場次裡的「用球數」只用來算球材成本參考值和羽球庫存(`Finance.shuttleStock()`)。**不要為了讓每場帳看起來完整而把球費加進現金流,那會重複記帳。**
- **單顆球成本一律走 `shuttleUnitPrice()`**(= 目前使用球種的 `price / balls`),不要直接讀 `cfg().shuttlePrice` —— 那只是沒登記任何球種時的備援值。
- **自動帳 vs 手動帳**:場地費、臨打收入、季費都是從場次和繳納紀錄**即時算出來的**(`Finance.ledger()`),不寫進 `txns`。`txns` 只放買球、贊助、聚餐這類自己輸入的收支。這樣改一場的資料,帳目自動跟著變,不會有兩份對不起來的數字。

## 同步設計

- 讀寫都走使用者自己部署的 Apps Script(`Sync.call`),Sheet 不需要公開。
- 寫入是**整張表覆寫**(`putTable`),不做逐列 upsert。資料量小(幾十人、一年上百場),換來的是幾乎不會有同步錯位的 bug;代價是同一時間兩支手機改同一張表會後蓋前,這是刻意的取捨,不要改成逐列同步而不先討論。
- 任何會改資料的操作:先 `Store.save()` 存進手機,再 `Sync.bg(table)` 背景送出。**畫面不要等網路**。
- 照片存 Google Drive,App 只存 `{id, caption}`,顯示用 `Sync.photoUrl(id, 寬度)`(Drive 的 thumbnail 網址)。上傳前一定要先 `compressImage()`,原圖直傳會超過 Apps Script 的 POST 上限。

## 互動慣例

- 每頁右上角「＋」的行為定義在 `js/app.js` 的 `PAGES`;沒有新增動作的頁面把 `add` 設 `null`,按鈕會自動隱藏。
- 彈窗一律用 `Modal.open(html)`,關閉鈕加 `data-close`。
- 有需要即時反映的表單(例如場次的結算),重畫前**一定要先 `readForm()`** 把使用者打到一半的字存回 draft,不然會被洗掉。
- 提示訊息用 `toast()`,不要用 `alert()`;破壞性操作(刪除、覆蓋)用 `await ask('…')`(`js/ui.js`),不要用瀏覽器的 `confirm()` —— 樣式在手機上很突兀。用了 `ask()` 的事件處理器記得加 `async`。
- **場次表單不要整段重畫**:勾出席、加臨打、改金額都只更新有變動的那一小塊(`togglePick` / `bindGuestRow` / `renderSettle`)。整段 `innerHTML` 重寫會讓正在輸入的欄位失焦、手機鍵盤收起來。
- 有結果的操作(勾出席、標記已收、換主題色)呼叫 `haptic()` 震一下。

## 測試

沒有自動化測試。改完在本機起靜態伺服器手動點過:

```bash
npx -y http-server -p 8091 -c-1 .
```

至少走一遍:記一場球(勾季打、加男女臨打確認單場費 180/160、改場地費)→ 看收支餘額有沒有跟著變 → 收季費 →
設定頁新增球種確認單顆成本換算、記一筆買球看金額顆數自動帶 → 場次刪除後帳目也要跟著消失。
