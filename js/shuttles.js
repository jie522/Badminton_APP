/* 羽球品項管理:登記球種(一筒幾顆、一筒多少錢),自動換算單顆成本
 *
 * 每一種球各自算庫存:買進的顆數(收支頁的「買球」)− 用掉的顆數(場次的用球明細)。
 * 一場球可以同時用到多種球(例如新球打前兩小時、練習球收尾),各記各的數量、各算各的錢。
 *
 * 「目前使用」的球種只是預設值:記買球時預設選它、場次的用球列表把它排在最前面。
 */
const Shuttles = {
  list() { return Store.load('shuttles', []); },
  saveList(l) { Store.save('shuttles', l); Sync.bg('shuttles'); },
  byId(id) { return this.list().find(s => s.id === id) || null; },

  /* 目前使用的球種:有標記的優先,沒標記就用第一個 */
  current() {
    const l = this.list();
    return l.find(s => s.current) || l[0] || null;
  },

  /* 單顆成本;沒登記任何球種時退回設定裡的備援值 */
  unitPrice(s) {
    const t = s === undefined ? this.current() : s;
    if (!t) return num(cfg().shuttlePrice, DEFAULTS.shuttlePrice);
    const balls = num(t.balls);
    return balls > 0 ? num(t.price) / balls : 0;
  },

  /* 用 id 取單顆成本:球種不存在(沒指定 / 已刪除)時退回設定裡的備援值 */
  unitPriceOf(sid) {
    const s = sid ? this.byId(sid) : null;
    return s ? this.unitPrice(s) : num(cfg().shuttlePrice, DEFAULTS.shuttlePrice);
  },

  /* 用 id 取名稱,給場次和帳目顯示 */
  nameOf(sid) {
    if (!sid) return '未指定球種';
    const s = this.byId(sid);
    return s ? s.name : '已刪除的球種';
  },

  /* 單顆成本的顯示字串(小數點只留到角,免得 20.833333 這種數字塞滿畫面) */
  unitLabel(s) {
    const v = this.unitPrice(s);
    return '$' + (Math.round(v * 10) / 10).toLocaleString('en-US');
  },

  priceLabel(v) {
    return '$' + (Math.round(num(v) * 10) / 10).toLocaleString('en-US');
  },

  /* ---------- 庫存(每一種球分開算) ----------
   * 期初:開始用這個 App 記帳前已經有的顆數(openStock);
   * 買進:收支頁「買球」那筆帳的顆數;用掉:各場次用球明細裡這一種的數量。
   * 沒指定球種的舊帳 / 自訂買球,歸到 sid === '' 這一組(沒有期初數量可設)。
   */
  stock() {
    const map = {};
    const touch = sid => (map[sid] = map[sid] || { sid, open: 0, bought: 0, used: 0 });
    this.list().forEach(s => { touch(s.id).open = num(s.openStock); });
    Finance.txns().forEach(t => {
      if (t.cat !== '買球') return;
      touch(t.shuttleId || '').bought += num(t.qty);
    });
    Sessions.list().forEach(s =>
      (s.shuttleUse || []).forEach(u => { touch(u.sid || '').used += num(u.n); }));

    return Object.values(map)
      .map(r => ({ ...r, left: r.open + r.bought - r.used, name: this.nameOf(r.sid), unit: this.unitPriceOf(r.sid) }))
      /* 沒登記、也沒買賣紀錄的空組別不用佔位置 */
      .filter(r => r.sid || r.open || r.bought || r.used)
      .sort((a, b) => {
        const cur = (this.current() || {}).id;
        if (a.sid === cur) return -1;
        if (b.sid === cur) return 1;
        return String(a.name).localeCompare(String(b.name), 'zh-Hant');
      });
  },

  stockOf(sid) {
    const r = this.stock().find(x => x.sid === (sid || ''));
    return r ? r.left : 0;
  },

  /* 場次用球列表要顯示哪些球種:登記過的 + 這場已經記過的(含已刪除的球種) */
  optionsFor(use) {
    const ids = this.list().map(s => s.id);
    (use || []).forEach(u => { if (!ids.includes(u.sid || '')) ids.push(u.sid || ''); });
    if (!ids.length) ids.push('');          // 一種球都沒登記時,至少給一個「未指定球種」
    return ids.map(sid => ({
      sid, name: this.nameOf(sid), unit: this.unitPriceOf(sid), left: this.stockOf(sid),
      photoId: (sid && (this.byId(sid) || {}).photoId) || '',
    }));
  },

  setCurrent(id) {
    const l = this.list();
    l.forEach(s => { s.current = s.id === id; });
    this.saveList(l);
  },

  /* ---------- 設定頁的球種清單 ---------- */
  render() {
    const box = document.getElementById('shuttle-list');
    if (!box) return;
    const l = this.list();
    if (!l.length) {
      box.innerHTML = `<p class="hint">還沒有登記球種,目前每場用球以單顆 ${money(cfg().shuttlePrice)} 估算。</p>`;
      return;
    }
    const cur = this.current();
    const stock = this.stock();
    const stockOf = sid => stock.find(r => r.sid === sid) || { open: 0, bought: 0, used: 0, left: 0 };

    box.innerHTML = l.map(s => {
      const st = stockOf(s.id);
      const thumb = s.photoId
        ? `<img class="date-tile shuttle-thumb" src="${esc(Sync.photoUrl(s.photoId, 120))}" alt="" loading="lazy"
             onerror="Shuttles.thumbFallback(this)">`
        : `<div class="date-tile icon-only">${icon('shuttle', '', 22)}</div>`;
      return `<button class="row-card ${cur && s.id === cur.id ? 'in-left' : ''}" data-id="${esc(s.id)}">
        ${thumb}
        <div class="row-main">
          <div class="row-title" style="font-size:15px">${esc(s.name)}
            ${cur && s.id === cur.id ? '<span class="chip">目前使用</span>' : ''}
            ${st.left <= 0 && (st.bought || st.open) ? '<span class="chip unpaid">用完了</span>'
              : st.left > 0 && st.left < 6 ? '<span class="chip unpaid">快用完</span>' : ''}</div>
          <div class="row-sub">一筒 ${num(s.balls)} 顆 · ${money(s.price)}
            · ${st.open ? `期初 ${st.open} / ` : ''}買 ${st.bought} / 用 ${st.used}</div>
        </div>
        <div class="row-right">
          <div class="row-amount">${st.left}<span style="font-size:12px"> 顆</span></div>
          <div class="row-note">${this.unitLabel(s)} / 顆</div>
        </div>
      </button>`;
    }).join('');

    /* 沒指定球種的舊帳也要看得到,不然庫存數字會對不起來 */
    const misc = stock.find(r => !r.sid);
    if (misc) box.insertAdjacentHTML('beforeend', `
      <div class="row-card">
        <div class="row-main">
          <div class="row-title" style="font-size:15px">未指定球種</div>
          <div class="row-sub">買 ${misc.bought} / 用 ${misc.used} · 記買球或用球時沒選球種的都算在這裡</div>
        </div>
        <div class="row-right"><div class="row-amount">${misc.left}<span style="font-size:12px"> 顆</span></div></div>
      </div>`);

    box.querySelectorAll('.row-card[data-id]').forEach(el =>
      el.addEventListener('click', () => this.openEdit(el.dataset.id)));
  },

  /* 列表縮圖 <img onerror> 讀不到照片時呼叫這個,換回球拍圖示方塊 */
  thumbFallback(img) {
    const div = document.createElement('div');
    div.className = 'date-tile icon-only';
    div.innerHTML = icon('shuttle', '', 22);
    img.replaceWith(div);
  },

  /* 編輯彈窗裡的大預覽圖讀不到時同樣退回圖示 */
  previewFallback(img) {
    const div = document.createElement('div');
    div.className = 'shuttle-photo-preview icon-only';
    div.innerHTML = icon('shuttle', '', 28);
    img.replaceWith(div);
  },

  /* 場次表單用球列表的小 logo 讀不到時退回圖示(見 js/sessions.js 的 useRowHtml) */
  rowLogoFallback(img) {
    const div = document.createElement('div');
    div.className = 'u-logo icon-only';
    div.innerHTML = icon('shuttle', '', 18);
    img.replaceWith(div);
  },

  openAdd() { this.openEdit(null); },

  openEdit(id) {
    const s = id ? this.byId(id) : null;
    const isCurrent = s ? (this.current() || {}).id === s.id : this.list().length === 0;
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>${s ? '編輯球種' : '新增球種'}</h2>
      ${s ? `
      <div class="shuttle-photo-row">
        ${s.photoId
          ? `<img class="shuttle-photo-preview" src="${esc(Sync.photoUrl(s.photoId, 200))}" alt=""
               onerror="Shuttles.previewFallback(this)">`
          : `<div class="shuttle-photo-preview icon-only">${icon('shuttle', '', 28)}</div>`}
        <div>
          <button type="button" class="btn small" id="sh-photo-btn">${s.photoId ? '換照片' : '上傳照片'}</button>
          ${s.photoId ? '<button type="button" class="link-btn" id="sh-photo-remove" style="display:block">移除照片</button>' : ''}
        </div>
      </div>` : ''}
      <label>球種名稱</label>
      <input type="text" id="sh-name" value="${esc(s ? s.name : '')}" placeholder="例如:YONEX AS-9">
      <div class="field-row">
        <div><label>一筒幾顆</label><input type="number" id="sh-balls" inputmode="numeric" value="${s ? num(s.balls) : 12}"></div>
        <div><label>一筒多少錢</label><input type="number" id="sh-price" inputmode="numeric" value="${s ? num(s.price) : ''}"></div>
      </div>
      <div class="settle">
        <div class="settle-line total"><span>換算單顆成本</span><span class="n" id="sh-unit">—</span></div>
      </div>
      <label>期初數量(顆)</label>
      <input type="number" id="sh-open" inputmode="numeric" value="${s ? num(s.openStock) : 0}">
      <p class="hint" style="margin-top:-6px">開始用這個 App 記帳前,手上已經有的顆數(不是買球紀錄,直接算進庫存)。</p>
      <label>使用狀態</label>
      <div class="type-picker" id="sh-current">
        <button data-cur="1" class="${isCurrent ? 'active' : ''}">目前使用</button>
        <button data-cur="0" class="${isCurrent ? '' : 'active'}">備用 / 停用</button>
      </div>
      <button class="btn primary block" id="sh-save">儲存</button>
      ${s ? '<button class="btn danger block" id="sh-del">刪除這個球種</button>' : ''}
    `);

    if (s) {
      document.getElementById('sh-photo-btn').addEventListener('click', () =>
        this.pickPhoto(s.id, () => this.openEdit(s.id)));
      const rm = document.getElementById('sh-photo-remove');
      if (rm) rm.addEventListener('click', async () => {
        if (!await ask('移除這張照片?')) return;
        this.removePhoto(s.id);
        this.openEdit(s.id);
      });
    }

    const balls = document.getElementById('sh-balls');
    const price = document.getElementById('sh-price');
    const unit = document.getElementById('sh-unit');
    const refresh = () => {
      unit.textContent = num(balls.value) > 0
        ? this.unitLabel({ balls: balls.value, price: price.value })
        : '—';
    };
    [balls, price].forEach(el => el.addEventListener('input', refresh));
    refresh();

    document.querySelectorAll('#sh-current button').forEach(b =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#sh-current button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      }));

    document.getElementById('sh-save').addEventListener('click', () => {
      const name = document.getElementById('sh-name').value.trim();
      if (!name) { toast('請輸入球種名稱'); return; }
      if (num(balls.value) <= 0) { toast('一筒幾顆要大於 0'); return; }
      const rec = {
        id: s ? s.id : uid(),
        name,
        balls: num(balls.value),
        price: num(price.value),
        openStock: num(document.getElementById('sh-open').value),
        current: document.querySelector('#sh-current button.active').dataset.cur === '1',
        photoId: s ? (s.photoId || '') : '',   // 存檔是整包重建物件,照片要顯式帶過去才不會不見
      };
      const l = this.list();
      const i = l.findIndex(x => x.id === rec.id);
      if (i >= 0) l[i] = rec; else l.push(rec);
      if (rec.current) l.forEach(x => { if (x.id !== rec.id) x.current = false; });
      this.saveList(l);
      Modal.close();
      this.render();
      Sessions.render();
      Finance.render();
      toast(`已儲存,單顆 ${this.unitLabel(rec)}`);
    });

    const del = document.getElementById('sh-del');
    if (del) del.addEventListener('click', async () => {
      if (!await ask(`確定刪除球種「${s.name}」?已經記過的買球帳目不受影響。`)) return;
      this.saveList(this.list().filter(x => x.id !== s.id));
      Modal.close();
      this.render();
      Sessions.render();
      Finance.render();
      toast('已刪除');
    });
  },

  /* ---------- 球種照片 ----------
   * 跟球員大頭貼一樣只存一張(不是相簿陣列),換照片直接覆蓋、把舊檔案丟到 Drive 垃圾桶。
   */
  pickPhoto(id, onDone) {
    if (!Sync.enabled()) { toast('照片存在 Google Drive,請先到「設定」啟用同步'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (file) await this.uploadPhoto(id, file);
      if (onDone) onDone();
    });
    input.click();
  },

  async uploadPhoto(id, file) {
    const s = this.byId(id);
    if (!s) return;
    const oldId = s.photoId;
    try {
      const img = await compressImage(file, 640, 0.85);
      const newId = await Sync.uploadPhoto({
        name: `shuttle_${id}.jpg`, mime: img.mime, b64: img.b64, sessionDate: 'shuttle',
      });
      const list = this.list();
      const rec = list.find(x => x.id === id);
      rec.photoId = newId;
      this.saveList(list);
      if (oldId) Sync.deletePhoto(oldId);
      this.render();
      toast('照片已更新');
    } catch (e) {
      toast('上傳失敗,請再試一次');
    }
  },

  removePhoto(id) {
    const list = this.list();
    const rec = list.find(x => x.id === id);
    if (!rec || !rec.photoId) return;
    const oldId = rec.photoId;
    rec.photoId = '';
    this.saveList(list);
    Sync.deletePhoto(oldId);
    this.render();
    toast('已移除照片');
  },
};

/* 場次結算要用的單顆成本 */
function shuttleUnitPrice() { return Shuttles.unitPrice(); }
