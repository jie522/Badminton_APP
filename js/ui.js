/* 共用 UI 小工具:主題、確認彈窗、頭像、觸覺回饋
 *
 * 這支要在 store.js 之後、其他模組之前載入(用到 cfg() / setCfg())。
 * 主題設定存在 settings 裡,屬於「這支手機的設定」,不會同步到 Google Sheet。
 */

/* ---------- 主題 ---------- */
const Theme = {
  MODES: { auto: '跟隨系統', light: '淺色', dark: '深色' },
  /* 每個色的代表色(設定頁的圓形色塊用),實際配色在 css/style.css 的 :root[data-accent] */
  ACCENTS: { green: '#12967c', blue: '#1668c9', orange: '#d9622b', purple: '#7a4bd0' },

  mode() { const m = cfg().theme; return this.MODES[m] ? m : 'auto'; },
  accent() { const a = cfg().accent; return this.ACCENTS[a] ? a : 'green'; },

  /* 目前實際是不是深色(auto 時看系統) */
  isDark() {
    const m = this.mode();
    if (m === 'dark') return true;
    if (m === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  },

  apply() {
    const root = document.documentElement;
    const m = this.mode();
    if (m === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', m);
    root.setAttribute('data-accent', this.accent());
    /* 手機瀏覽器上方那條列的顏色要跟著背景走 */
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', this.isDark() ? '#12141c' : '#f4f5f7');
  },

  set(patch) {
    setCfg(patch);
    this.apply();
  },
};

/* 系統在 auto 模式下切換深淺色時,跟著換 theme-color */
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (Theme.mode() === 'auto') Theme.apply();
});

/* ---------- App 內的確認對話框 ----------
 * 取代瀏覽器的 confirm():樣式一致、可以放在動畫裡,而且不會凍住整個頁面。
 * 用法:if (!await ask('確定刪除?')) return;
 */
function ask(msg, opts = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'ask-backdrop';
    wrap.innerHTML = `
      <div class="ask-box" role="dialog" aria-modal="true">
        <div class="ask-msg">${esc(msg)}</div>
        <div class="btn-row">
          <button class="btn" data-no>${esc(opts.cancel || '取消')}</button>
          <button class="btn ${opts.danger === false ? 'primary' : 'danger'}" data-yes>${esc(opts.ok || '確定')}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const done = val => {
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      resolve(val);
    };
    const onKey = e => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', e => { if (e.target === wrap) done(false); });
    wrap.querySelector('[data-no]').addEventListener('click', () => done(false));
    wrap.querySelector('[data-yes]').addEventListener('click', () => { haptic(); done(true); });
    wrap.querySelector('[data-yes]').focus();
  });
}

/* ---------- 觸覺回饋 ---------- */
/* 勾出席、標記已收這種「有結果」的操作震一下,手指不用回頭確認畫面 */
function haptic(ms = 10) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* 不支援就算了 */ } }
}

/* ---------- 名字頭像 ---------- */
const AVATAR_COLORS = ['#e05a4f', '#e08a3c', '#b8931f', '#3fa35b', '#2f9e9e', '#3a7bd5', '#7a5cd0', '#c452a0'];

/* 同一個名字永遠是同一個顏色(用字碼加總挑色) */
function avatarColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 1)) % 9973;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/* 頭像上顯示哪個字:英文名取首字母,中文取最後一個字(阿宏、小美這種取後面比較好認) */
function avatarChar(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  if (/^[A-Za-z]/.test(s)) return s[0].toUpperCase();
  return s[s.length - 1];
}

function avatarHtml(name, cls = '') {
  return `<div class="avatar ${cls}" style="--av:${avatarColor(name)}" aria-hidden="true">${esc(avatarChar(name))}</div>`;
}

/* ---------- 圓環進度 ---------- */
/* size 78 / 半徑 32:周長約 201,dashoffset 用百分比推 */
function ringHtml(pct, label) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const C = 2 * Math.PI * 32;
  return `<div class="ring-wrap">
    <svg class="ring" width="78" height="78" viewBox="0 0 78 78" role="img" aria-label="${esc(label || p + '%')}">
      <circle class="track" cx="39" cy="39" r="32"></circle>
      <circle class="bar" cx="39" cy="39" r="32"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - p / 100)).toFixed(1)}"></circle>
    </svg>
    <div class="ring-pct">${p}%</div>
  </div>`;
}
