/* 主程式:頁籤切換、彈窗、設定頁 */
const Modal = {
  open(html) {
    const backdrop = document.getElementById('modal-backdrop');
    const modal = document.getElementById('modal');
    modal.innerHTML = html;
    modal.scrollTop = 0;
    backdrop.classList.remove('hidden');
    modal.querySelectorAll('[data-close]').forEach(el =>
      el.addEventListener('click', () => this.close()));
  },
  close() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.getElementById('modal').innerHTML = '';
  },
};

document.getElementById('modal-backdrop').addEventListener('click', e => {
  if (e.target.id === 'modal-backdrop') Modal.close();
});

/* ---------- 頁籤 ---------- */
const PAGES = {
  sessions: { title: '打球場次', add: () => Sessions.openAdd(), addLabel: '記一場球' },
  season: { title: '季打管理', add: () => Members.openAdd('season'), addLabel: '新增季打球員' },
  members: { title: '臨打名單', add: () => Members.openAdd('guest'), addLabel: '新增臨打球友' },
  finance: { title: '公款收支', add: () => Finance.openAdd(), addLabel: '記一筆收支' },
  photos: { title: '球隊相簿', add: () => Photos.openAdd(), addLabel: '上傳照片' },
  settings: { title: '設定', add: null },
};
let currentPage = 'sessions';

const fab = document.getElementById('fab-add');

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.page === page;
    t.classList.toggle('active', on);
    t.setAttribute('aria-current', on ? 'page' : 'false');
  });
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === 'page-' + page));
  document.getElementById('header-title').textContent = PAGES[page].title;
  fab.classList.toggle('hidden', !PAGES[page].add);
  if (PAGES[page].add) fab.setAttribute('aria-label', PAGES[page].addLabel);
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tab').forEach(tab =>
  tab.addEventListener('click', () => switchPage(tab.dataset.page)));

fab.addEventListener('click', () => {
  const fn = PAGES[currentPage].add;
  if (fn) { haptic(); fn(); }
});

/* ---------- 分段篩選 ---------- */
function syncFilterUI() {
  document.querySelectorAll('#session-filter button').forEach(b =>
    b.classList.toggle('active', b.dataset.range === Sessions.filter));
  document.querySelectorAll('#finance-filter button').forEach(b =>
    b.classList.toggle('active', b.dataset.kind === Finance.filter));
}

document.querySelectorAll('#session-filter button').forEach(btn =>
  btn.addEventListener('click', () => {
    Sessions.filter = btn.dataset.range;
    syncFilterUI();
    Sessions.render();
  }));
document.querySelectorAll('#finance-filter button').forEach(btn =>
  btn.addEventListener('click', () => {
    Finance.filter = btn.dataset.kind;
    syncFilterUI();
    Finance.render();
  }));

/* ---------- 季打 / 人員(臨打)頁搜尋 ----------
 * 兩個分頁各自獨立的搜尋框,用同一組綁定邏輯處理,只是欄位 id 和渲染方法不一樣。
 */
function bindMemberSearch(inputId, clearId, qKey, renderFn) {
  const input = document.getElementById(inputId);
  const clear = document.getElementById(clearId);
  input.addEventListener('input', () => {
    Members[qKey] = input.value;
    clear.classList.toggle('hidden', !Members[qKey]);
    renderFn();
  });
  clear.addEventListener('click', () => {
    input.value = '';
    Members[qKey] = '';
    clear.classList.add('hidden');
    renderFn();
    input.focus();
  });
}
bindMemberSearch('season-member-search', 'season-member-search-clear', 'seasonQ', () => Members.renderSeasonPage());
bindMemberSearch('member-search', 'member-search-clear', 'guestQ', () => Members.renderGuestPage());

/* ---------- 設定:外觀 ---------- */
function loadThemeForm() {
  document.querySelectorAll('#theme-mode button').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === Theme.mode()));
  document.querySelectorAll('#theme-accent .swatch').forEach(b =>
    b.classList.toggle('on', b.dataset.accent === Theme.accent()));
}

document.querySelectorAll('#theme-mode button').forEach(btn =>
  btn.addEventListener('click', () => {
    Theme.set({ theme: btn.dataset.mode });
    loadThemeForm();
  }));
document.querySelectorAll('#theme-accent .swatch').forEach(btn =>
  btn.addEventListener('click', () => {
    Theme.set({ accent: btn.dataset.accent });
    loadThemeForm();
    haptic();
  }));

/* ---------- 設定:收費 ---------- */
const SET_FIELDS = ['guestFeeM', 'guestFeeF', 'acFee', 'venue', 'time'];

function loadSettingsForm() {
  const c = cfg();
  SET_FIELDS.forEach(k => { document.getElementById('set-' + k).value = c[k]; });
}

document.getElementById('save-settings').addEventListener('click', () => {
  const patch = {};
  SET_FIELDS.forEach(k => {
    const v = document.getElementById('set-' + k).value;
    patch[k] = (k === 'venue' || k === 'time') ? v.trim() : num(v, DEFAULTS[k]);
  });
  setCfg(patch);
  loadSettingsForm();
  Sessions.render();
  Members.refreshBoth();
  Finance.render();
  toast('設定已儲存');
});

/* ---------- 設定:公款起始餘額 ---------- */
document.getElementById('ob-save').addEventListener('click', () => {
  const raw = document.getElementById('ob-amount').value;
  const date = document.getElementById('ob-date').value;
  Finance.setOpeningBalance(raw, date);
  Finance.loadOpeningForm();
  Finance.render();
  toast(num(raw) ? '已儲存公款起始餘額' : '已清除公款起始餘額');
});

/* ---------- 設定:羽球品項 ---------- */
document.getElementById('shuttle-add').addEventListener('click', () => Shuttles.openAdd());

/* ---------- Google Sheet 同步 ---------- */
const scriptInput = document.getElementById('script-url');
const syncStatus = document.getElementById('sync-status');
const syncBtn = document.getElementById('sync-indicator');

/* 頁首右上角那顆:一眼看出資料到底有沒有存到雲端 */
function setSyncUI(state, label) {
  syncBtn.className = 'sync-btn ' + state;
  syncBtn.querySelector('.s-label').textContent = label;
}

function refreshSyncStatus() {
  const s = Store.load('settings', {});
  if (Sync.enabled()) {
    scriptInput.value = Sync.url();
    const t = s.lastSync ? new Date(s.lastSync).toLocaleString('zh-TW') : '尚未同步';
    syncStatus.textContent = `✅ 同步已啟用,上次讀取:${t}`;
    setSyncUI('on', '已同步');
  } else {
    syncStatus.textContent = '尚未啟用,目前資料只存在這支手機';
    setSyncUI('', '未同步');
  }
}

syncBtn.addEventListener('click', async () => {
  if (!Sync.enabled()) {
    switchPage('settings');
    scriptInput.focus();
    toast('貼上 Apps Script 網址就能開始同步');
    return;
  }
  setSyncUI('busy', '同步中');
  if (await pullAndRender()) toast('已同步最新資料');
});

function renderAll() {
  Sessions.render();
  Members.refreshBoth();
  Finance.render();
  Finance.loadOpeningForm();   // 別的裝置改過起始餘額,同步回來後設定頁的欄位也要跟著換
  Photos.render();
  Shuttles.render();
}

async function pullAndRender() {
  setSyncUI('busy', '同步中');
  try {
    await Sync.pull();
    /* Sheet 上如果還留著舊版產生的 $0 季費紀錄,pull 下來又會蓋回本機,
     * 清完立刻同步回去,這樣 Sheet 那份也會跟著乾淨,不用每次開機都在清。 */
    if (cleanZeroPayments()) Sync.bg('payments');
    renderAll();
    refreshSyncStatus();
    return true;
  } catch {
    setSyncUI('err', '同步失敗');
    toast('⚠️ 讀取 Google Sheet 失敗,顯示手機上的資料');
    return false;
  }
}

document.getElementById('save-script').addEventListener('click', async () => {
  const url = scriptInput.value.trim();
  if (!url) {
    const s = Store.load('settings', {});
    delete s.scriptUrl;
    Store.save('settings', s);
    refreshSyncStatus();
    toast('已停用同步');
    return;
  }
  if (!/^https:\/\/script\.google(?:usercontent)?\.com\//.test(url)) {
    toast('網址看起來不對,應該是 script.google.com 開頭');
    return;
  }
  setCfg({ scriptUrl: url });
  syncStatus.textContent = '測試連線中…';
  setSyncUI('busy', '連線中');
  const ok = await Sync.push('ping', {});
  if (!ok) {
    syncStatus.textContent = '❌ 連不上 Apps Script,請確認部署時「誰可以存取」選了「所有人」';
    setSyncUI('err', '連不上');
    return;
  }
  const counts = Store.TABLES.map(t => Store.load(t, []).length).reduce((a, b) => a + b, 0);
  if (counts && await ask(
      `連線成功!\n要把這支手機現有的資料(共 ${counts} 筆)上傳到 Google Sheet 嗎?\n\n(球友的手機第一次啟用時選「先不要」就好)`,
      { ok: '上傳', cancel: '先不要', danger: false })) {
    syncStatus.textContent = '上傳中…';
    const up = await Sync.pushAll();
    toast(up ? '已上傳到 Google Sheet' : '⚠️ 上傳失敗,請再試一次');
  }
  await pullAndRender();
  toast('✅ 同步已啟用');
});

document.getElementById('sync-now').addEventListener('click', async () => {
  if (!Sync.enabled()) { toast('請先貼上 Apps Script 網址'); return; }
  syncStatus.textContent = '同步中…';
  if (await pullAndRender()) toast('已同步最新資料');
  else refreshSyncStatus();
});

/* ---------- 設定:備份 ---------- */
document.getElementById('export-data').addEventListener('click', () => Store.exportAll());
document.getElementById('import-data').addEventListener('click', () =>
  document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (!await ask('匯入會覆蓋這支手機目前的資料,確定嗎?')) { e.target.value = ''; return; }
  Store.importAll(file, ok => {
    if (ok) {
      loadSettingsForm();
      loadThemeForm();
      Theme.apply();
      renderAll();
      toast('匯入成功!');
    } else {
      toast('匯入失敗:檔案格式不對');
    }
    e.target.value = '';
  });
});

/* ---------- 加到主畫面(PWA) ---------- */
/* 註冊 Service Worker 之後,球友可以把 App 加到手機主畫面,全螢幕開、沒網路也打得開 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 沒註冊成功就當一般網頁用 */ });
  });
}

/* ---------- 啟動 ---------- */
migrate();                            // 舊資料補上新欄位(性別、男女兩價)
Theme.apply();                        // 深淺色和主題色
hydrateIcons();                       // 把 data-icon 換成線條 SVG
loadThemeForm();
loadSettingsForm();
refreshSyncStatus();
syncFilterUI();
renderAll();                          // 先用本機資料畫面
switchPage('sessions');
if (Sync.enabled()) pullAndRender();  // 再從 Google Sheet 抓最新資料
