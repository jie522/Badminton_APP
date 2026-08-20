/* 資料儲存:localStorage 包裝 + 共用小工具
 *
 * 資料表(每張都是一個陣列,存在 localStorage,啟用同步後鏡像到 Google Sheet):
 *   members  球員       { id, name, type:'season'|'guest', gender:'M'|'F', phone, note, active, createdAt,
 *                        seasonFee,   ← 個人季費;留白 = 用季別預設,填 0 = 免繳(見 seasonFeeOf)
 *                        avatarId }   ← 大頭貼,Google Drive 檔案 id,沒上傳就退回名字色塊(見 avatarHtml)
 *   seasons  季別       { id, name, start, end, fee, photos:[{id, caption}] }
 *   payments 季費繳納   { id, seasonId, memberId, amount, date, note }
 *   sessions 打球場次   { id, date, venue, time,
 *                        courtFee,   ← 舊制:場地費逐場收。已改季繳(記一筆手動帳,分類選「包場 / 押金」),
 *                                       新場次固定是 0,欄位留著只是不讓舊資料的歷史數字消失
 *                        acFee,      ← 冷氣費,預設 0,新場次的每場設施費用改用這個欄位
 *                        shuttleUse:[{sid, n}],   ← 這場哪一種球用了幾顆(sid 空字串 = 未指定球種)
 *                        attendees:[memberId], guests:[{mid, fee, paid}],
 *                        note, photos:[{id, caption}], createdAt }
 *   shuttles 羽球品項   { id, name, balls, price, current,
 *                        photoId,    ← 這種球的參考照片(球盒/包裝),單張,沒上傳就顯示球拍圖示
 *                        openStock } ← 期初數量:開始用這個 App 記帳前已經有的顆數,算進庫存但不算「買進」
 *                      單顆成本 = price / balls
 *   txns     手動帳目   { id, date, kind:'in'|'out', cat, amount, qty, shuttleId, tubes, note,
 *                        photos:[{id, caption}] }
 *
 * 場次、季別、收支都能放照片(見 js/photos.js 的 Photos.OWNERS),存的都是 Google Drive 檔案 id,
 * 不是圖片本身。
 * 現金流的設計:場地費、臨打費、季費都是「從場次/繳納紀錄自動算出來的帳」,
 * 不重複存進 txns(見 finance.js 的 ledger()),txns 只放買球和其他雜項收支。
 */
const Store = {
  KEYS: {
    members: 'bad.members',
    seasons: 'bad.seasons',
    payments: 'bad.payments',
    sessions: 'bad.sessions',
    shuttles: 'bad.shuttles',
    txns: 'bad.txns',
    settings: 'bad.settings',
  },

  load(key, fallback) {
    try {
      const raw = localStorage.getItem(this.KEYS[key]);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },

  save(key, value) {
    localStorage.setItem(this.KEYS[key], JSON.stringify(value));
  },

  /* 同步到 Google Sheet 的資料表(不含 settings:設定是每支手機各自的)
   * 順序有意義:Sheet 上「季打名單」「用球明細」這些給人看的欄位,是寫入當下去查
   * 球員 / 球種名稱組出來的,所以被參照的表(members、shuttles)要排在 sessions 前面,
   * 不然第一次整批上傳時那幾欄會印出 id 而不是名字。 */
  TABLES: ['members', 'seasons', 'shuttles', 'payments', 'sessions', 'txns'],

  exportAll() {
    const data = { app: 'BADMAP', version: 1, exportedAt: new Date().toISOString() };
    this.TABLES.forEach(t => { data[t] = this.load(t, []); });
    data.settings = this.load('settings', {});
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `羽球管理備份_${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  importAll(file, done) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || data.app !== 'BADMAP') throw new Error('格式不對');
        this.TABLES.forEach(t => { if (Array.isArray(data[t])) this.save(t, data[t]); });
        if (data.settings) this.save('settings', { ...data.settings, ...pick(this.load('settings', {}), ['scriptUrl']) });
        done(true);
      } catch {
        done(false);
      }
    };
    reader.readAsText(file);
  },
};

/* ---------- 設定 ---------- */
const DEFAULTS = {
  guestFeeM: 180,     // 臨打單場費:男生
  guestFeeF: 160,     // 臨打單場費:女生
  shuttlePrice: 25,   // 單顆羽球成本;沒登記球種時的備援值(見 js/shuttles.js)
  acFee: 0,           // 預設冷氣費(場地費已改季繳,不逐場收了)
  venue: '佳青羽球館',
  time: '19:00-22:00',
  theme: 'auto',      // 深色 / 淺色 / 跟隨系統(見 js/ui.js 的 Theme)
  accent: 'green',    // 主題色:green / blue / orange / purple
};

function cfg() { return { ...DEFAULTS, ...Store.load('settings', {}) }; }

function setCfg(patch) {
  Store.save('settings', { ...Store.load('settings', {}), ...patch });
}

/* ---------- 性別與臨打費 ---------- */
const GENDER = { M: '男', F: '女' };

/* 沒設性別的舊資料一律當男生算,不會因為缺欄位就收不到錢 */
function genderOf(member) { return member && member.gender === 'F' ? 'F' : 'M'; }

/* 這位球友這場該收多少:依性別帶入設定的單場費 */
function guestFeeOf(member) {
  const c = cfg();
  return num(genderOf(member) === 'F' ? c.guestFeeF : c.guestFeeM);
}

/* 有沒有設「個人季費」——
 * 留白(''、undefined)= 沒設,用季別預設;填 0 = 真的免繳,兩者不一樣,
 * 所以這裡不能用 num() 判斷(num('') 和 num(0) 都是 0)。 */
function hasOwnSeasonFee(member) {
  const raw = member && member.seasonFee;
  if (raw === '' || raw === undefined || raw === null) return false;
  /* 只認得出數字才算數:Sheet 欄位對位跑掉時會讀到「季打」這種字,
   * 那種情況要當作沒設定(回去用季別預設),不能變成免繳。 */
  return Number.isFinite(parseFloat(raw));
}

/* 這位季打球員這一季該繳多少:
 * 有設個人季費就用他自己的(學生半價 1500、教練免繳 0),沒設就用季別的預設季費。 */
function seasonFeeOf(member, season) {
  if (hasOwnSeasonFee(member)) return num(member.seasonFee);
  return num(season && season.fee);
}

/* 舊版本存下來的資料補上新欄位(只在啟動時跑一次) */
function migrate() {
  const s = Store.load('settings', {});
  if (s.guestFee !== undefined) {                 // 舊版單一價 → 男女兩價
    if (s.guestFeeM === undefined) s.guestFeeM = s.guestFee;
    if (s.guestFeeF === undefined) s.guestFeeF = s.guestFee;
    delete s.guestFee;
    Store.save('settings', s);
  }
  const members = Store.load('members', []);
  if (members.some(m => !m.gender)) {
    members.forEach(m => { if (!m.gender) m.gender = 'M'; });
    Store.save('members', members);
  }
  /* 舊版一場只記一個總用球數 → 改成分球種記,舊資料掛到「目前使用」的球種 */
  const sessions = Store.load('sessions', []);
  if (sessions.some(s => s.shuttles !== undefined && !s.shuttleUse)) {
    const cur = (Store.load('shuttles', []).find(x => x.current) || Store.load('shuttles', [])[0] || {}).id || '';
    sessions.forEach(s => {
      if (!s.shuttleUse) s.shuttleUse = num(s.shuttles) > 0 ? [{ sid: cur, n: num(s.shuttles) }] : [];
      delete s.shuttles;
    });
    Store.save('sessions', sessions);
  }
  cleanZeroPayments();
}

/* 清掉 $0 / 負數的季費繳納紀錄(舊版曾在「免繳」狀態下誤按產生 $0 紀錄,
 * 應收金額不受影響,但收支頁會多一筆看不出意義的「季費 $0」,下次真的收費時
 * 又疊一筆新紀錄,看起來像分兩次繳)。開機清一次、每次從 Sheet 拉回資料後也清一次
 * (見 app.js 的 pullAndRender),不然 Sheet 上的舊紀錄會一直蓋回來。
 * 回傳有沒有清掉東西,呼叫端用這個決定要不要同步回 Sheet。 */
function cleanZeroPayments() {
  const list = Store.load('payments', []);
  const kept = list.filter(p => num(p.amount) > 0);
  if (kept.length === list.length) return false;
  Store.save('payments', kept);
  return true;
}

function pick(obj, keys) {
  const o = {};
  keys.forEach(k => { if (obj[k] !== undefined) o[k] = obj[k]; });
  return o;
}

/* ---------- 小工具 ---------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/* 金額顯示:1200 → $1,200 */
function money(n) {
  const v = Math.round(num(n));
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
}

function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/* 下一個週五(今天如果就是週五就回傳今天):新增場次表單的日期預設用這個,
 * 球隊固定週五打球,不用每次手動改日期。 */
function nextFriday(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + (5 - d.getDay() + 7) % 7);
  return todayStr(d);
}

/* '2026-08-18' → '8/18(二)' */
function shortDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${+m[2]}/${+m[3]}(${WEEKDAYS[d.getDay()]})`;
}

/* '2026-08-18' → { md: '8/18', wd: '週二' },給場次卡左邊的日期方塊用 */
function dateParts(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { md: iso || '', wd: '' };
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return { md: `${+m[2]}/${+m[3]}`, wd: '週' + WEEKDAYS[d.getDay()] };
}

function monthOf(iso) { return String(iso || '').slice(0, 7); }

function byDateDesc(a, b) {
  if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
  return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}
