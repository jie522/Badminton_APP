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
  sessions: { title: '打球場次', add: () => Sessions.openAdd() },
  members: { title: '球員名單', add: () => Members.openAdd() },
  finance: { title: '公款收支', add: () => Finance.openAdd() },
  photos: { title: '球隊相簿', add: () => Photos.openAdd() },
  settings: { title: '設定', add: null },
};
let currentPage = 'sessions';

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.page === page));
  document.querySelectorAll('.page').forEach(p =>
    p.classList.toggle('active', p.id === 'page-' + page));
  document.getElementById('header-title').textContent = PAGES[page].title;
  document.getElementById('header-action').classList.toggle('hidden', !PAGES[page].add);
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tab').forEach(tab =>
  tab.addEventListener('click', () => switchPage(tab.dataset.page)));

document.getElementById('header-action').addEventListener('click', () => {
  const fn = PAGES[currentPage].add;
  if (fn) fn();
});

/* ---------- 分段篩選 ---------- */
function syncFilterUI() {
  document.querySelectorAll('#session-filter button').forEach(b =>
    b.classList.toggle('active', b.dataset.range === Sessions.filter));
  document.querySelectorAll('#member-filter button').forEach(b =>
    b.classList.toggle('active', b.dataset.type === Members.filter));
  document.querySelectorAll('#finance-filter button').forEach(b =>
    b.classList.toggle('active', b.dataset.kind === Finance.filter));
}

document.querySelectorAll('#session-filter button').forEach(btn =>
  btn.addEventListener('click', () => {
    Sessions.filter = btn.dataset.range;
    syncFilterUI();
    Sessions.render();
  }));
document.querySelectorAll('#member-filter button').forEach(btn =>
  btn.addEventListener('click', () => {
    Members.filter = btn.dataset.type;
    syncFilterUI();
    Members.render();
  }));
document.querySelectorAll('#finance-filter button').forEach(btn =>
  btn.addEventListener('click', () => {
    Finance.filter = btn.dataset.kind;
    syncFilterUI();
    Finance.render();
  }));

/* ---------- 設定:收費 ---------- */
const SET_FIELDS = ['guestFeeM', 'guestFeeF', 'courtFee', 'venue', 'time'];

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
  Members.render();
  Finance.render();
  toast('設定已儲存');
});

/* ---------- 設定:羽球品項 ---------- */
document.getElementById('shuttle-add').addEventListener('click', () => Shuttles.openAdd());

/* ---------- 設定:Google Sheet 同步 ---------- */
const scriptInput = document.getElementById('script-url');
const syncStatus = document.getElementById('sync-status');

function refreshSyncStatus() {
  const s = Store.load('settings', {});
  if (Sync.enabled()) {
    scriptInput.value = Sync.url();
    const t = s.lastSync ? new Date(s.lastSync).toLocaleString('zh-TW') : '尚未同步';
    syncStatus.textContent = `✅ 同步已啟用,上次讀取:${t}`;
  } else {
    syncStatus.textContent = '尚未啟用,目前資料只存在這支手機';
  }
}

function renderAll() {
  Sessions.render();
  Members.render();
  Finance.render();
  Photos.render();
  Shuttles.render();
}

async function pullAndRender() {
  try {
    await Sync.pull();
    renderAll();
    refreshSyncStatus();
    return true;
  } catch {
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
  const ok = await Sync.push('ping', {});
  if (!ok) {
    syncStatus.textContent = '❌ 連不上 Apps Script,請確認部署時「誰可以存取」選了「所有人」';
    return;
  }
  const counts = Store.TABLES.map(t => Store.load(t, []).length).reduce((a, b) => a + b, 0);
  if (counts && confirm(`連線成功!要把這支手機現有的資料(共 ${counts} 筆)上傳到 Google Sheet 嗎?\n(球友的手機第一次啟用時選「取消」就好)`)) {
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
document.getElementById('import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('匯入會覆蓋這支手機目前的資料,確定嗎?')) { e.target.value = ''; return; }
  Store.importAll(file, ok => {
    if (ok) {
      loadSettingsForm();
      renderAll();
      toast('匯入成功!');
    } else {
      toast('匯入失敗:檔案格式不對');
    }
    e.target.value = '';
  });
});

/* ---------- 啟動 ---------- */
migrate();                            // 舊資料補上新欄位(性別、男女兩價)
loadSettingsForm();
refreshSyncStatus();
syncFilterUI();
renderAll();                          // 先用本機資料畫面
switchPage('sessions');
if (Sync.enabled()) pullAndRender();  // 再從 Google Sheet 抓最新資料
