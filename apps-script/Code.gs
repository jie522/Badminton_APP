/* BADMAP 羽球管理 - Google Sheet / Drive 儲存服務
 *
 * 設定方式(一次性,約 5 分鐘,只有隊長要做):
 * 1. 到 https://sheets.new 建一份新的 Google Sheet,取名例如「羽球管理」
 * 2. 上方選單「擴充功能」→「Apps Script」
 * 3. 刪掉編輯器裡原本的內容,把這整份檔案貼上,按存檔(磁碟片圖示)
 * 4. 右上角「部署」→「新增部署作業」→ 齒輪選「網頁應用程式」
 *    - 執行身分:我
 *    - 誰可以存取:所有人
 * 5. 按「部署」,授權自己的 Google 帳號,複製產生的「網頁應用程式 URL」
 * 6. 把 URL 貼到 App 的「設定」頁 →「Google Sheet 同步」→ 儲存並啟用
 *    球友的手機貼同一個網址就會看到同一份資料(他們啟用時,上傳那一步選「取消」)
 *
 * 分頁和欄位 App 會自動建立,不用自己開。照片會存進你 Google Drive 的
 * 「羽球管理APP 相簿」資料夾(想指定別的資料夾,見下面 PHOTO_FOLDER_ID 說明)。
 *
 * 之後改了這份程式碼,記得「部署」→「管理部署作業」→ 編輯(鉛筆)→ 版本選「新版本」→ 部署,
 * 不然線上跑的還是舊版。VERSION 會在 ping 時回傳,可以用來確認。
 */

var VERSION = 9;

/* 這份程式碼**建議**用「在 Sheet 裡開啟 Apps Script」的方式部署(擴充功能 → Apps Script),
 * 這樣它會自動綁定那份 Sheet,不用填任何 id。
 * 只有當你把它貼在「獨立的 Apps Script 專案」時,才需要告訴它要寫進哪份 Sheet:
 * 到「專案設定 → 指令碼屬性」新增 SHEET_ID = 試算表網址中 /d/ 和 /edit 之間那一長串。
 * 指令碼屬性只存在你自己的專案裡,不會出現在公開的 GitHub 上。 */

/* 照片資料夾:留空就自動用(或建立)根目錄下的「羽球管理APP 相簿」。
 * 想放在指定資料夾,就到「專案設定 → 指令碼屬性」新增 PHOTO_FOLDER_ID = 資料夾 id。 */
var PHOTO_FOLDER_NAME = '羽球管理APP 相簿';

/* ---------- 資料表定義 ---------- */
var TABLES = {
  members: {
    tab: '球員',
    fields: ['id', 'name', 'type', 'gender', 'phone', 'note', 'active', 'createdAt', 'seasonFee', 'avatarId'],
    headers: ['id', '姓名', '類型', '性別', '電話', '備註', '啟用', '建立時間', '個人季費', '大頭貼id'],
    extraHeaders: ['類型(中文)', '性別(中文)'],
    extras: function (o) {
      return [o.type === 'guest' ? '臨打' : '季打', o.gender === 'F' ? '女' : '男'];
    },
  },
  seasons: {
    tab: '季別',
    fields: ['id', 'name', 'start', 'end', 'fee', 'photos'],
    headers: ['id', '季別名稱', '開始日期', '結束日期', '季費', '照片'],
  },
  payments: {
    tab: '季費繳納',
    fields: ['id', 'seasonId', 'memberId', 'amount', 'date', 'note'],
    headers: ['id', '季別id', '球員id', '金額', '日期', '備註'],
    extraHeaders: ['球員', '季別'],
    extras: function (o, ctx) { return [ctx.memberName(o.memberId), ctx.seasonName(o.seasonId)]; },
  },
  sessions: {
    tab: '場次',
    fields: ['id', 'date', 'venue', 'time', 'courtFee', 'acFee', 'shuttleUse', 'attendees', 'guests', 'note', 'photos', 'createdAt'],
    headers: ['id', '日期', '場地', '時間', '場地費(舊制)', '冷氣費', '用球(json)', '季打出席(id)', '臨打(json)', '備註', '照片(json)', '建立時間'],
    extraHeaders: ['季打名單', '臨打名單', '出席人數', '臨打收入', '用球明細', '用球總數'],
    extras: function (o, ctx) {
      var att = (o.attendees || []).map(ctx.memberName).join('、');
      var guests = o.guests || [];
      var gl = guests.map(function (g) { return ctx.memberName(g.mid) + (g.paid ? '' : '(未收)'); }).join('、');
      var income = 0;
      guests.forEach(function (g) { if (g.paid) income += Number(g.fee) || 0; });
      var use = o.shuttleUse || [];
      var total = 0;
      var detail = use.map(function (u) {
        total += Number(u.n) || 0;
        return (u.sid ? ctx.shuttleName(u.sid) : '未指定') + ' ' + (Number(u.n) || 0) + ' 顆';
      }).join('、');
      return [att, gl, (o.attendees || []).length + guests.length, income, detail, total];
    },
  },
  shuttles: {
    tab: '羽球品項',
    fields: ['id', 'name', 'balls', 'price', 'current', 'photoId'],
    headers: ['id', '球種名稱', '一筒幾顆', '一筒價格', '目前使用', '照片id'],
    extraHeaders: ['單顆成本'],
    extras: function (o) {
      var balls = Number(o.balls) || 0;
      return [balls > 0 ? Math.round((Number(o.price) || 0) / balls * 10) / 10 : ''];
    },
  },
  txns: {
    tab: '帳目',
    fields: ['id', 'date', 'kind', 'cat', 'amount', 'qty', 'shuttleId', 'tubes', 'note', 'photos'],
    headers: ['id', '日期', '收支', '分類', '金額', '顆數', '球種id', '筒數', '備註', '照片'],
    extraHeaders: ['收支(中文)', '球種'],
    extras: function (o, ctx) {
      return [o.kind === 'in' ? '收入' : '支出', o.shuttleId ? ctx.shuttleName(o.shuttleId) : ''];
    },
  },
};

var JSON_FIELDS = ['attendees', 'guests', 'photos', 'shuttleUse'];
var NUM_FIELDS = ['fee', 'amount', 'qty', 'courtFee', 'acFee', 'shuttles', 'balls', 'price', 'tubes'];
var BOOL_FIELDS = ['active', 'current'];
/* 值是空白時要當成 true 的布林欄位(active 沒填代表還在打;current 沒填代表不是目前使用的球種) */
var BOOL_DEFAULT_TRUE = ['active'];
var DATE_FIELDS = ['date', 'start', 'end'];
/* 這些欄位一定要當文字存,不然 Google 會把 id 或日期自動轉型 */
var TEXT_FIELDS = ['id', 'seasonId', 'memberId', 'shuttleId', 'date', 'start', 'end', 'time', 'phone', 'createdAt', 'seasonFee', 'avatarId', 'photoId'];

/* ---------- 入口 ---------- */
function doPost(e) {
  var out;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var req = JSON.parse(e.postData.contents);
    out = handle(req.action, req.data || {});
  } catch (err) {
    out = { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/* 直接用瀏覽器打開網址時的回應,方便確認部署成功 */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, msg: 'BADMAP ready', v: VERSION }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle(action, d) {
  switch (action) {
    case 'ping': return { ok: true, msg: 'pong', v: VERSION };
    case 'pull': return pullAll();
    case 'putTable': putTable(d.table, d.rows || []); return { ok: true };
    case 'uploadPhoto': return uploadPhoto(d);
    case 'deletePhoto': return deletePhoto(d);
    default: return { ok: false, error: 'unknown action: ' + action };
  }
}

/* ---------- 分頁 ---------- */
/* 綁在 Sheet 上時直接拿當前試算表;獨立專案就用指令碼屬性 SHEET_ID 指定 */
function ss() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('找不到試算表:請用「Sheet → 擴充功能 → Apps Script」部署,或在指令碼屬性設定 SHEET_ID');
  return SpreadsheetApp.openById(id);
}

function sheetFor(name) {
  var def = TABLES[name];
  var book = ss();
  var sh = book.getSheetByName(def.tab);
  if (!sh) sh = book.insertSheet(def.tab);
  var want = def.headers.concat(def.extraHeaders || []);
  if (sh.getLastRow() === 0) {
    sh.appendRow(want);
    sh.setFrozenRows(1);
  } else {
    // 欄位有增減時(App 改版)把表頭補成新的,不然標題會跟資料對不起來
    var got = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), want.length)).getValues()[0];
    var same = want.length === sh.getLastColumn();
    for (var i = 0; same && i < want.length; i++) same = String(got[i]) === want[i];
    if (!same) sh.getRange(1, 1, 1, want.length).setValues([want]);
  }
  // id / 日期這類欄位鎖成純文字,避免 Google 自動轉型
  def.fields.forEach(function (f, i) {
    if (TEXT_FIELDS.indexOf(f) >= 0) {
      sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    }
  });
  return sh;
}

function fmtDate(v) {
  // 不用 instanceof Date:getValues 回傳的 Date 來自另一個 context,判斷會失效
  if (v && typeof v.getTime === 'function') {
    var tz = ss().getSpreadsheetTimeZone();
    return Utilities.formatDate(new Date(v.getTime()), tz, 'yyyy-MM-dd');
  }
  return String(v == null ? '' : v).trim();
}

function boolDefault(field) { return BOOL_DEFAULT_TRUE.indexOf(field) >= 0; }

function toCell(field, value) {
  if (JSON_FIELDS.indexOf(field) >= 0) return JSON.stringify(value || []);
  if (BOOL_FIELDS.indexOf(field) >= 0) {
    var v = (value === undefined || value === null || value === '') ? boolDefault(field) : !!value;
    return v ? 'TRUE' : 'FALSE';
  }
  if (NUM_FIELDS.indexOf(field) >= 0) return Number(value) || 0;
  return value == null ? '' : String(value);
}

function fromCell(field, value) {
  if (JSON_FIELDS.indexOf(field) >= 0) {
    try { return JSON.parse(value || '[]'); } catch (e) { return []; }
  }
  if (BOOL_FIELDS.indexOf(field) >= 0) {
    var s = String(value).trim().toUpperCase();
    if (s === 'TRUE' || value === true) return true;
    if (s === 'FALSE' || value === false) return false;
    return boolDefault(field); // 空白:依欄位而定
  }
  if (NUM_FIELDS.indexOf(field) >= 0) return Number(value) || 0;
  if (DATE_FIELDS.indexOf(field) >= 0) return fmtDate(value);
  return value == null ? '' : String(value).trim();
}

/* 整張表覆寫(App 端資料量小,直接全表同步最不會出錯) */
function putTable(name, rows) {
  var def = TABLES[name];
  if (!def) throw new Error('unknown table: ' + name);
  var sh = sheetFor(name);
  var ctx = nameCtx();
  var width = def.headers.length + (def.extraHeaders ? def.extraHeaders.length : 0);

  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  if (!rows.length) return;

  var out = rows.map(function (o) {
    var line = def.fields.map(function (f) { return toCell(f, o[f]); });
    if (def.extras) line = line.concat(def.extras(o, ctx));
    while (line.length < width) line.push('');
    return line;
  });
  sh.getRange(2, 1, out.length, width).setValues(out);
}

function readTable(name) {
  var def = TABLES[name];
  var sh = sheetFor(name);
  if (sh.getLastRow() < 2) return [];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, def.fields.length).getValues();
  var out = [];
  values.forEach(function (row) {
    if (!String(row[0] || '').trim()) return; // 沒有 id 的列(手動加的空白列)略過
    var o = {};
    def.fields.forEach(function (f, i) { o[f] = fromCell(f, row[i]); });
    out.push(o);
  });
  return out;
}

function pullAll() {
  var out = { ok: true, v: VERSION };
  Object.keys(TABLES).forEach(function (name) { out[name] = readTable(name); });
  return out;
}

/* 給「季打名單」這種人看的欄位用的名稱對照 */
function nameCtx() {
  var members = {}, seasons = {}, shuttles = {};
  try {
    readTable('members').forEach(function (m) { members[m.id] = m.name; });
    readTable('seasons').forEach(function (s) { seasons[s.id] = s.name; });
    readTable('shuttles').forEach(function (s) { shuttles[s.id] = s.name; });
  } catch (e) { /* 第一次同步時分頁還沒建好,空的就好 */ }
  return {
    memberName: function (id) { return members[id] || id || ''; },
    seasonName: function (id) { return seasons[id] || id || ''; },
    shuttleName: function (id) { return shuttles[id] || id || ''; },
  };
}

/* ---------- 照片(Google Drive) ---------- */
function photoFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* id 失效就往下重建 */ }
  }
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function uploadPhoto(d) {
  var folder = photoFolder();
  // 一個月一個子資料夾,幾年下來在 Drive 裡也好找
  var sub = String(d.sessionDate || '').slice(0, 7) || 'misc';
  var it = folder.getFoldersByName(sub);
  var target = it.hasNext() ? it.next() : folder.createFolder(sub);

  var blob = Utilities.newBlob(Utilities.base64Decode(d.b64), d.mime || 'image/jpeg', d.name || 'photo.jpg');
  var file = target.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // 公司/學校帳號可能禁止公開連結,照片仍存起來了,只是別人看不到
    return { ok: true, id: file.getId(), warn: 'SHARING_BLOCKED' };
  }
  return { ok: true, id: file.getId() };
}

function deletePhoto(d) {
  try {
    DriveApp.getFileById(d.id).setTrashed(true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
