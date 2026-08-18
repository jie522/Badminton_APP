/* 羽球品項管理:登記球種(一筒幾顆、一筒多少錢),自動換算單顆成本
 *
 * 「目前使用」的球種決定兩件事:
 *   1. 場次結算裡「用掉 N 顆球」的球材成本
 *   2. 收支頁記「買球」時,選幾筒自動算出金額和顆數
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

  /* 單顆成本的顯示字串(小數點只留到角,免得 20.833333 這種數字塞滿畫面) */
  unitLabel(s) {
    const v = this.unitPrice(s);
    return '$' + (Math.round(v * 10) / 10).toLocaleString('en-US');
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
    box.innerHTML = l.map(s => `
      <button class="row-card ${cur && s.id === cur.id ? 'in-left' : ''}" data-id="${esc(s.id)}">
        <div class="row-main">
          <div class="row-title" style="font-size:15px">${esc(s.name)}
            ${cur && s.id === cur.id ? '<span class="chip">目前使用</span>' : ''}</div>
          <div class="row-sub">一筒 ${num(s.balls)} 顆 · ${money(s.price)}</div>
        </div>
        <div class="row-right">
          <div class="row-amount">${this.unitLabel(s)}</div>
          <div class="row-note">每顆</div>
        </div>
      </button>`).join('');
    box.querySelectorAll('.row-card').forEach(el =>
      el.addEventListener('click', () => this.openEdit(el.dataset.id)));
  },

  openAdd() { this.openEdit(null); },

  openEdit(id) {
    const s = id ? this.byId(id) : null;
    const isCurrent = s ? (this.current() || {}).id === s.id : this.list().length === 0;
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>${s ? '編輯球種' : '新增球種'}</h2>
      <label>球種名稱</label>
      <input type="text" id="sh-name" value="${esc(s ? s.name : '')}" placeholder="例如:YONEX AS-9">
      <div class="field-row">
        <div><label>一筒幾顆</label><input type="number" id="sh-balls" inputmode="numeric" value="${s ? num(s.balls) : 12}"></div>
        <div><label>一筒多少錢</label><input type="number" id="sh-price" inputmode="numeric" value="${s ? num(s.price) : ''}"></div>
      </div>
      <div class="settle">
        <div class="settle-line total"><span>換算單顆成本</span><span class="n" id="sh-unit">—</span></div>
      </div>
      <label>使用狀態</label>
      <div class="type-picker" id="sh-current">
        <button data-cur="1" class="${isCurrent ? 'active' : ''}">目前使用</button>
        <button data-cur="0" class="${isCurrent ? '' : 'active'}">備用 / 停用</button>
      </div>
      <button class="btn primary block" id="sh-save">儲存</button>
      ${s ? '<button class="btn danger block" id="sh-del">刪除這個球種</button>' : ''}
    `);

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
        current: document.querySelector('#sh-current button.active').dataset.cur === '1',
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
};

/* 場次結算要用的單顆成本 */
function shuttleUnitPrice() { return Shuttles.unitPrice(); }
