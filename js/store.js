/* 資料儲存:localStorage 包裝 + 共用小工具
 *
 * 資料表(每張都是一個陣列,存在 localStorage,啟用同步後鏡像到 Google Sheet):
 *   members  球員       { id, name, type:'season'|'guest', gender:'M'|'F', phone, note, active, createdAt }
 *   seasons  季別       { id, name, start, end, fee }
 *   payments 季費繳納   { id, seasonId, memberId, amount, date, note }
 *   sessions 打球場次   { id, date, venue, time, courtFee, shuttles,
 *                        attendees:[memberId], guests:[{mid, fee, paid}],
 *                        note, photos:[{id, caption}], createdAt }
 *   shuttles 羽球品項   { id, name, balls, price, current }   單顆成本 = price / balls
 *   txns     手動帳目   { id, date, kind:'in'|'out', cat, amount, qty, shuttleId, tubes, note }
 *
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

  /* 同步到 Google Sheet 的資料表(不含 settings:設定是每支手機各自的) */
  TABLES: ['members', 'seasons', 'payments', 'sessions', 'shuttles', 'txns'],

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
  courtFee: 800,      // 預設場地費
  venue: '佳青羽球館',
  time: '19:00-22:00',
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

/* '2026-08-18' → '8/18(二)' */
function shortDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${+m[2]}/${+m[3]}(${WEEKDAYS[d.getDay()]})`;
}

function monthOf(iso) { return String(iso || '').slice(0, 7); }

function byDateDesc(a, b) {
  if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
  return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
}
