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
- **不要 transition `color` 或 `border-color`**:這兩個屬性一旦有 transition,切換深淺色主題時會卡在舊顏色不更新(瀏覽器不會為「因 CSS 變數改變而變的顏色」重新啟動 transition),結果是切到淺色後頁籤還留著深色模式的螢光綠。按壓回饋只 transition `transform` 和 `background-color`。
- **圖示用 `js/ui.js` 的 `ICONS`**,不要用 emoji:emoji 在各平台長得不一樣、大小對不齊,而且不能跟著主題色變色。HTML 寫 `<span data-icon="shuttle" data-size="24"></span>`,啟動時 `hydrateIcons()` 會換成線條 SVG;JS 產生的內容用 `icon('coins', '', 18)`。
- **手機優先**:所有版面以 375px 寬為基準設計,`main` 最大寬 720px 置中;可點的東西高度至少 38px。
- **不要引入框架或 npm 套件**,保持「clone 下來用瀏覽器打開就能跑」。

## 資料模型(js/store.js 開頭有完整註解)

六張表:`members`(球員)、`seasons`(季別)、`payments`(季費繳納)、`sessions`(場次)、`shuttles`(羽球品項)、`txns`(手動帳目)。
`settings` 是裝置設定,**不同步**。

新增欄位時三個地方要一起改,少一個資料就會在同步時掉:

1. `js/store.js` 開頭的資料表註解
2. `apps-script/Code.gs` 的 `TABLES` 定義(`fields` + `headers`,必要時 `extras` 人看的欄位)。
   `extras` 裡查名字的欄位(季打名單、用球明細…)是**寫入當下**去查對照表組出來的,所以
   `Store.TABLES` 的順序要讓被參照的表(members、shuttles)排在 sessions 前面,否則第一次整批上傳會印出 id
3. 若是陣列/物件欄位,加進 `Code.gs` 的 `JSON_FIELDS`;數字加進 `NUM_FIELDS`;日期加進 `DATE_FIELDS` 和 `TEXT_FIELDS`;布林欄位加進 `BOOL_FIELDS`,**空白時該視為 true 的才加進 `BOOL_DEFAULT_TRUE`**(`active` 是,`current` 不是)

舊資料的欄位補齊寫在 `js/store.js` 的 `migrate()`,啟動時跑一次;新增有預設值的欄位時記得一起補。

改完 `Code.gs` 要把 `VERSION` +1,並提醒使用者到 Apps Script「管理部署作業 → 新版本」重新部署,否則線上跑的還是舊版。

## 記帳規則(改動前務必先讀)

- **季打球員**:繳季費,場地費由公款支付,**每場不再收錢**。季費只記「已繳 / 未繳」,不逐場扣款。
- **季費金額看人**:一律走 `seasonFeeOf(member, season)` —— 球員有設 `seasonFee` 就用他的,沒設才用 `season.fee`。
  **不要直接讀 `season.fee` 來判斷某個人該繳多少**,那會把學生半價、教練免繳的人算錯。
  `seasonFee` 留白(`''`)= 跟大家一樣,填 `0` = **免繳**,兩者不同,所以判斷有沒有設定要用 `hasOwnSeasonFee()`,
  不能用 `num(m.seasonFee) > 0`(`num('')` 和 `num(0)` 都是 0,分不出來)。
  免繳的人在 `Seasons.summary()` 算「已繳」(不然進度到不了 100%),收季費畫面也不給按(按了會產生 $0 的空繳費紀錄)。
  應收總額是每個人的季費**逐一加總**,不是「預設季費 × 人數」。
  `payments` 是逐筆累加的表(`Seasons.pay()` 每次呼叫都新增一筆,不是覆寫),
  所以 `pay()` 內建擋 `amount <= 0` 不建立紀錄 —— 免繳的人本來就不該有繳費紀錄,
  建了會在收支頁多一筆看不出意義的「季費 $0」,下次真的收費時又疊一筆,看起來像分兩次繳。
  舊資料裡殘留的 $0 紀錄靠 `cleanZeroPayments()` 清,`migrate()` 開機清一次、
  `Sync.pull()` 拉回資料後也要清一次(見 `app.js` 的 `pullAndRender`),
  不然 Sheet 上的舊紀錄會每次同步又蓋回本機。
- **臨打球友**:每場收一次單場費,**金額依性別**(`guestFeeOf(member)` → `cfg().guestFeeM` / `guestFeeF`,預設男 180 / 女 160),可個別調金額、標記已收 / 未收。性別欄位缺漏時 `genderOf()` 一律當男生算,不要讓缺欄位變成收不到錢。
- **每場公款進出** = 臨打收入 − 場地費。
- **球費不進每場現金流**:買球的錢在「收支」頁記買球那筆時就已經付出去了,場次裡的用球明細只用來算球材成本參考值和羽球庫存。**不要為了讓每場帳看起來完整而把球費加進現金流,那會重複記帳。**
- **用球分球種記**:`session.shuttleUse = [{sid, n}]`,一場可以同時用到多種球,各自用 `Shuttles.unitPriceOf(sid)` 算錢再加總(`Sessions.calc()` 的 `shuttleCost`)。`sid` 是空字串代表「未指定球種」,單價退回 `cfg().shuttlePrice`。**不要再回頭改成單一 `shuttles` 數字欄位。**
- **庫存分球種算**:`Shuttles.stock()` = 每種球的「買球帳目顆數 − 各場用掉顆數」。編輯舊場次時畫面上的即時庫存要用 `Sessions.liveLeft()`(先把這場原本用掉的加回來),否則會自己扣自己兩次。
- **自動帳 vs 手動帳**:場地費、臨打收入、季費都是從場次和繳納紀錄**即時算出來的**(`Finance.ledger()`),不寫進 `txns`。`txns` 只放買球、贊助、聚餐這類自己輸入的收支。這樣改一場的資料,帳目自動跟著變,不會有兩份對不起來的數字。
- **公款起始餘額**:中途才開始用這個 App 記帳時補的一筆設定值(`Finance.openingBalance()` / `setOpeningBalance()`),
  存成 `txns` 裡 `cat === Finance.OPENING_CAT`(`'期初餘額'`)的單一筆紀錄,金額可正可負(虧空用負數,存成 `kind:'out'`)。
  **不要把 `OPENING_CAT` 加進 `IN_CATS` / `OUT_CATS`**,不然會在「記一筆收支」的分類選單被選到,使用者手動記一筆就重複了。
  它算進 `Finance.totals()` 的總餘額(這正是它存在的目的),但要從「本季收支」和「近 6 個月」趨勢圖的來源資料**排除**
  (`render()` 裡的 `activity`)——它不是這季發生的活動,混進去本季收入會平白多一筆,金額大還會把趨勢圖其他月份壓扁。
  改動走設定頁的專屬表單(`#ob-amount` / `#ob-date`),不走「記一筆收支」彈窗,金額填 0 或清空就是刪除這筆設定。

## 同步設計

- 讀寫都走使用者自己部署的 Apps Script(`Sync.call`),Sheet 不需要公開。
- 寫入是**整張表覆寫**(`putTable`),不做逐列 upsert。資料量小(幾十人、一年上百場),換來的是幾乎不會有同步錯位的 bug;代價是同一時間兩支手機改同一張表會後蓋前,這是刻意的取捨,不要改成逐列同步而不先討論。
- 任何會改資料的操作:先 `Store.save()` 存進手機,再 `Sync.bg(table)` 背景送出。**畫面不要等網路**。
- 照片存 Google Drive,App 只存 `{id, caption}`,顯示用 `Sync.photoUrl(id, 寬度)`(Drive 的 thumbnail 網址)。上傳前一定要先 `compressImage()`,原圖直傳會超過 Apps Script 的 POST 上限。
- **場次、季別、收支都能放照片**,共用 `js/photos.js` 的 `Photos` 模組,存取方式的對照表在 `Photos.OWNERS`——
  要讓新的資料表也能放照片,在這裡加一筆設定就好,不用另外寫上傳 / 顯示 / 刪除邏輯。
  **這三張表的編輯彈窗存檔時都是整包重建 `rec` 物件**(不是深拷貝原紀錄),
  一定要把 `photos: t ? (t.photos || []) : []` 帶進 `rec`,不然存檔會把照片清空
  (`Sessions.save()` 因為是深拷貝 draft 所以天然沒這個問題,`Seasons.openEdit` / `Finance.openEdit` / `Members.openEdit` 存檔都是整包重建,要注意)。
- **球員大頭貼**跟場次/季別/收支的照片不一樣,只存一張(`member.avatarId`,單一 Drive 檔案 id,不是陣列),
  換照片用 `Members.uploadAvatar()` 直接覆蓋、把舊檔案丟到 Drive 垃圾桶,不會累積孤兒檔案。
  同樣要注意 `Members.openEdit` 存檔時整包重建 `rec`,要帶 `avatarId: m ? (m.avatarId || '') : ''`。

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
