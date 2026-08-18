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

/* ---------- 圖示 ----------
 * 用手繪的線條 SVG 取代 emoji:emoji 在 Android / iOS / Windows 長得都不一樣,
 * 大小也對不齊,而且沒辦法跟著主題色變色。這裡的圖示都用 currentColor,
 * 放進 .tab.active 就會自動變成主題色。
 *
 * 用法:HTML 寫 <span data-icon="shuttle" data-size="24"></span>,啟動時 hydrateIcons() 會填進去。
 */
const ICONS = {
  shuttle: '<path d="M8.4 3.6h7.2l-1.2 9.7H9.6z"/><path d="M10.8 3.6l.5 9.7M13.2 3.6l-.5 9.7"/><circle cx="12" cy="16.8" r="3.6"/>',
  users: '<circle cx="9.2" cy="8" r="3.3"/><path d="M3.4 19.6c0-3.1 2.6-5.3 5.8-5.3s5.8 2.2 5.8 5.3"/><path d="M16.4 5.2a3.3 3.3 0 0 1 0 5.6M17.6 14.6c1.9.7 3.2 2.4 3.2 4.5"/>',
  wallet: '<path d="M3.6 8.4A2.4 2.4 0 0 1 6 6h11.6A2.4 2.4 0 0 1 20 8.4v9.2a2.4 2.4 0 0 1-2.4 2.4H6a2.4 2.4 0 0 1-2.4-2.4z"/><path d="M3.8 8.6l.6-3.1a1.4 1.4 0 0 1 1.7-1.1l9.3 2"/><path d="M20 11.6h-3.4a1.9 1.9 0 0 0 0 3.8H20"/>',
  camera: '<path d="M3.4 8.6a2 2 0 0 1 2-2h1.9l1.2-2.2h7l1.2 2.2h1.9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  sliders: '<path d="M4 7h8M17 7h3M4 12h3M12 12h8M4 17h8M17 17h3"/><circle cx="14.5" cy="7" r="2.1"/><circle cx="9.5" cy="12" r="2.1"/><circle cx="14.5" cy="17" r="2.1"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  coins: '<ellipse cx="12" cy="6.8" rx="6.8" ry="2.9"/><path d="M5.2 6.8v4.9c0 1.6 3 2.9 6.8 2.9s6.8-1.3 6.8-2.9V6.8"/><path d="M5.2 11.7v4.9c0 1.6 3 2.9 6.8 2.9s6.8-1.3 6.8-2.9v-4.9"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.4"/><path d="M15.6 15.6L20 20"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chevron: '<path d="M9.5 5.8l6.2 6.2-6.2 6.2"/>',
};

function icon(name, cls = '', size = 24) {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* 把畫面上所有 <span data-icon="…"> 換成真的 SVG */
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    el.innerHTML = icon(el.dataset.icon, el.dataset.iconClass || '', num(el.dataset.size, 24));
  });
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
