/* 公款收支:季費、臨打費、場地費、買球與其他雜支
 *
 * 帳目分兩種來源:
 *   自動帳 — 從場次(場地費、臨打收入)和季費繳納紀錄算出來,改場次就會跟著變,不能直接編輯
 *   手動帳 — 買球、贊助、聚餐這類自己輸入的收支,存在 txns
 * 兩者合起來就是公款的完整流水帳。
 */
const Finance = {
  filter: 'all',
  OUT_CATS: ['買球', '場地季繳', '團服 / 器材', '聚餐', '其他支出'],
  IN_CATS: ['贊助 / 補助', '其他收入'],
  /* 起始餘額不放進上面兩個分類清單:它是設定頁單獨一筆的特例(見 openingBalance),
   * 不放進去就不會在「記一筆收支」的分類選單裡被選到,也就不會有人手動重複記一筆。 */
  OPENING_CAT: '期初餘額',

  txns() { return Store.load('txns', []); },
  saveTxns(l) { Store.save('txns', l); Sync.bg('txns'); },

  /* ---------- 起始餘額 ----------
   * 中途才開始用這個 App 記帳,帳戶裡可能早就有錢(或欠款),這裡讓隊長補一筆起始值。
   * 存成 txns 裡「期初餘額」這個特殊分類的單一筆紀錄(金額可正可負),
   * 這樣不用另外開一張同步表:它跟其他手動帳一樣會同步、會出現在流水帳裡,
   * 差別只在於改用設定頁的專屬表單來改,不走「記一筆收支」的彈窗。
   */
  openingBalance() {
    const t = this.txns().find(x => x.cat === this.OPENING_CAT);
    if (!t) return { amount: 0, date: '' };
    return { amount: t.kind === 'out' ? -num(t.amount) : num(t.amount), date: t.date };
  },

  /* 永遠只留一筆:金額填 0(或清空)就等於刪除這筆設定。
   * 改用原地更新(保留原本的 id 和 photos),不要整筆丟掉重建 ——
   * 這筆現在也能掛照片(例如舊帳本的照片),每次改金額都重建會讓照片憑空不見。 */
  setOpeningBalance(amount, date) {
    const n = num(amount);
    const list = this.txns();
    const i = list.findIndex(x => x.cat === this.OPENING_CAT);
    if (n === 0) {
      if (i >= 0) list.splice(i, 1);
    } else {
      const rec = {
        id: i >= 0 ? list[i].id : uid(),
        date: date || todayStr(),
        kind: n > 0 ? 'in' : 'out', cat: this.OPENING_CAT,
        amount: Math.abs(n), qty: 0, shuttleId: '', tubes: 0,
        note: '接續舊帳本的起始金額',
        photos: i >= 0 ? (list[i].photos || []) : [],
      };
      if (i >= 0) list[i] = rec; else list.push(rec);
    }
    this.saveTxns(list);
  },

  loadOpeningForm() {
    const amt = document.getElementById('ob-amount');
    if (!amt) return;
    const o = this.openingBalance();
    amt.value = o.amount || '';
    document.getElementById('ob-date').value = o.date || todayStr();
  },

  /* ---------- 完整流水帳 ---------- */
  ledger() {
    const rows = [];

    Sessions.list().forEach(s => {
      const c = Sessions.calc(s);
      if (c.courtFee) rows.push({   // 舊制場地費,只有舊資料才會有(場地費已改季繳)
        date: s.date, kind: 'out', cat: '場地費', amount: c.courtFee,
        note: `${s.venue || '打球'} · ${c.head} 人`, src: 'session', srcId: s.id,
      });
      if (c.acFee) rows.push({
        date: s.date, kind: 'out', cat: '冷氣費', amount: c.acFee,
        note: `${s.venue || '打球'} · ${c.head} 人`, src: 'session', srcId: s.id,
      });
      if (c.guestIncome) rows.push({
        date: s.date, kind: 'in', cat: '臨打費', amount: c.guestIncome,
        note: `${s.guests.filter(g => g.paid).length} 位臨打`, src: 'session', srcId: s.id,
      });
    });

    Seasons.payments().forEach(p => {
      const season = Seasons.byId(p.seasonId);
      rows.push({
        date: p.date, kind: 'in', cat: '季費', amount: num(p.amount),
        note: `${Members.name(p.memberId)}${season ? ' · ' + season.name : ''}`,
        src: 'payment', srcId: p.id,
      });
    });

    this.txns().forEach(t => {
      const sh = t.shuttleId ? Shuttles.byId(t.shuttleId) : null;
      const label = [sh ? sh.name : '', num(t.tubes) ? num(t.tubes) + ' 筒' : '', t.note || '']
        .filter(Boolean).join(' · ');
      rows.push({
        date: t.date, kind: t.kind, cat: t.cat, amount: num(t.amount),
        note: label, qty: num(t.qty), src: 'txn', srcId: t.id,
      });
    });

    return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  totals(rows) {
    const income = rows.filter(r => r.kind === 'in').reduce((n, r) => n + r.amount, 0);
    const expense = rows.filter(r => r.kind === 'out').reduce((n, r) => n + r.amount, 0);
    return { income, expense, balance: income - expense };
  },

  /* ---------- 圖表 ---------- */

  /* 最近 n 個月的收入 / 支出小計(沒有帳的月份也要留位置,趨勢才看得出來) */
  monthly(rows, n = 6) {
    const now = new Date();
    const months = [];
    const map = {};
    for (let i = n - 1; i >= 0; i--) {
      const t = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = {
        key: `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`,
        label: (t.getMonth() + 1) + '月',
        in: 0, out: 0,
      };
      months.push(m);
      map[m.key] = m;
    }
    rows.forEach(r => {
      const m = map[monthOf(r.date)];
      if (m) m[r.kind] += r.amount;
    });
    return months;
  },

  chartHtml(rows) {
    const months = this.monthly(rows);
    const max = Math.max(1, ...months.map(m => Math.max(m.in, m.out)));
    /* 1,200 → +1.2k,標在長條上方,寬度才夠站得下 */
    const compact = n => {
      const a = Math.abs(n);
      return (n < 0 ? '−' : '+') + (a >= 1000 ? (Math.round(a / 100) / 10) + 'k' : a);
    };
    return `<div class="chart-card">
      <div class="chart-head">
        <span class="chart-title">近 6 個月收支</span>
        <span class="chart-legend"><span><i class="in"></i>收入</span><span><i class="out"></i>支出</span></span>
      </div>
      <div class="chart-bars">
        ${months.map(m => {
          const net = m.in - m.out;
          return `<div class="cbar">
            <span class="net ${net >= 0 ? 'in' : 'out'}">${m.in || m.out ? compact(net) : ''}</span>
            <div class="cbar-stack">
              <i class="in" style="height:${(m.in / max * 100).toFixed(1)}%" title="收入 ${money(m.in)}"></i>
              <i class="out" style="height:${(m.out / max * 100).toFixed(1)}%" title="支出 ${money(m.out)}"></i>
            </div>
            <span class="m">${m.label}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  },

  /* 這一季的季費收了幾成 */
  seasonPayHtml() {
    const season = Seasons.current();
    if (!season) return '';
    const s = Seasons.summary(season);
    if (!s.total || s.expected <= 0) return '';   // 應收是每個人的季費加總,不是預設季費 × 人數
    const pct = s.expected ? s.received / s.expected * 100 : 0;
    return `<div class="chart-card">
      <div class="chart-head"><span class="chart-title">${esc(season.name)} 季費收繳</span></div>
      <div class="ring-row">
        ${ringHtml(pct, `季費已收 ${Math.round(pct)}%`)}
        <div class="ring-info">
          已繳 <b>${s.paidCount}/${s.total}</b> 人<br>
          已收 <b>${money(s.received)}</b> / 應收 ${money(s.expected)}<br>
          ${s.expected > s.received
            ? `待收 <b>${money(s.expected - s.received)}</b>`
            : '這一季收齊了 🎉'}
        </div>
      </div>
    </div>`;
  },

  /* 羽球庫存合計(每一種球的明細見 Shuttles.stock()) */
  shuttleStock() {
    return Shuttles.stock().reduce((a, r) => ({
      open: a.open + (r.open || 0), bought: a.bought + r.bought, used: a.used + r.used, left: a.left + r.left,
    }), { open: 0, bought: 0, used: 0, left: 0 });
  },

  /* 各球種庫存卡:哪一種還剩幾顆、快用完了沒 */
  stockHtml() {
    const rows = Shuttles.stock();
    if (!rows.length) return '';
    return `<div class="chart-card">
      <div class="chart-head"><span class="chart-title">羽球庫存</span>
        <span class="chart-legend"><span>期初 + 買進 − 用掉</span></span></div>
      <div class="card-list">
        ${rows.map(r => `
          <div class="row-card ${r.left <= 0 ? 'out-left' : r.left < 6 ? '' : 'in-left'}">
            <div class="row-main">
              <div class="row-title" style="font-size:15px">${esc(r.name)}
                ${r.left <= 0 && (r.bought || r.open) ? '<span class="chip unpaid">用完了</span>'
                  : r.left > 0 && r.left < 6 ? '<span class="chip unpaid">快用完</span>' : ''}</div>
              <div class="row-sub">${r.open ? `期初 ${r.open} / ` : ''}買 ${r.bought} / 用 ${r.used} · 每顆 ${Shuttles.priceLabel(r.unit)}</div>
            </div>
            <div class="row-right">
              <div class="row-amount ${r.left <= 0 ? 'out' : ''}">${r.left}<span style="font-size:12px"> 顆</span></div>
              <div class="row-note">庫存值 ${money(Math.max(0, r.left) * r.unit)}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
  },

  /* ---------- 畫面 ---------- */
  render() {
    const rows = this.ledger();
    const all = this.totals(rows);           // 總餘額要含起始餘額,不然帳目對不起來
    const season = Seasons.current();
    /* 起始餘額不算「本季」收支,也不放進趨勢圖 —— 它是設定值不是這季發生的活動,
     * 混進去會讓「本季收入」憑空多一筆,金額大的話還會把趨勢圖其他月份的長條壓扁。 */
    const activity = rows.filter(r => r.cat !== this.OPENING_CAT);
    const seasonRows = season
      ? activity.filter(r => r.date >= (season.start || '') && r.date <= (season.end || '9999'))
      : activity;
    const st = this.totals(seasonRows);
    const stock = this.shuttleStock();
    const stockValue = Shuttles.stockValue();

    document.getElementById('finance-balance').innerHTML = `
      <div class="balance-card">
        <div class="k">公款餘額</div>
        <div class="v">${money(all.balance)}</div>
        <div class="balance-sub">
          <div><span>${season ? season.name + ' 收入' : '總收入'}</span><b>${money(st.income)}</b></div>
          <div><span>${season ? season.name + ' 支出' : '總支出'}</span><b>${money(st.expense)}</b></div>
          <div><span>羽球庫存價值</span><b>${money(stockValue)}</b></div>
        </div>
        ${stockValue ? `<div class="balance-total">公款餘額 + 羽球庫存 共 <b>${money(all.balance + stockValue)}</b></div>` : ''}
      </div>
      <div class="stat-grid">
        <div class="stat"><div class="k">羽球庫存(${stock.open ? `期初 ${stock.open} / ` : ''}買 ${stock.bought} / 用 ${stock.used})</div>
          <div class="v ${stock.left < 6 ? 'out' : ''}">${stock.left}<span style="font-size:12px"> 顆</span></div></div>
        <div class="stat"><div class="k">${esc((Shuttles.current() || {}).name || '單顆成本')}</div>
          <div class="v" style="font-size:15px">${Shuttles.unitLabel()}<span style="font-size:12px"> /顆</span></div></div>
        <div class="stat"><div class="k">待收臨打費</div><div class="v ${this.unpaidGuest() ? 'out' : ''}" style="font-size:15px">${money(this.unpaidGuest())}</div></div>
      </div>
      ${this.chartHtml(activity)}
      ${this.stockHtml()}
      ${this.seasonPayHtml()}`;

    const box = document.getElementById('finance-list');
    const empty = document.getElementById('finance-empty');
    const list = this.filter === 'all' ? rows : rows.filter(r => r.kind === this.filter);
    empty.classList.toggle('hidden', list.length > 0);

    box.innerHTML = list.map((r, i) => `
      <button class="row-card ${r.kind === 'in' ? 'in-left' : 'out-left'}" data-i="${i}">
        <div class="row-main">
          <div class="row-title" style="font-size:15px">${esc(r.cat)}
            ${r.cat === this.OPENING_CAT ? '<span class="chip off">設定值</span>'
              : r.src === 'txn' ? '' : '<span class="chip off">自動</span>'}</div>
          <div class="row-sub">${esc(shortDate(r.date))}${r.note ? ' · ' + esc(r.note) : ''}${r.qty ? ` · ${r.qty} 顆` : ''}</div>
        </div>
        <div class="row-right">
          <div class="row-amount ${r.kind}">${r.kind === 'in' ? '+' : '−'}${money(r.amount)}</div>
        </div>
      </button>`).join('');

    box.querySelectorAll('.row-card').forEach(el =>
      el.addEventListener('click', () => {
        const r = list[+el.dataset.i];
        if (r.cat === this.OPENING_CAT) { switchPage('settings'); this.loadOpeningForm(); document.getElementById('ob-amount').focus(); }
        else if (r.src === 'txn') this.openEdit(r.srcId);
        else if (r.src === 'session') Sessions.openEdit(r.srcId);
        else if (r.src === 'payment') Seasons.openEditPayment(r.srcId);
      }));
  },

  /* 所有場次裡還沒跟臨打球友收到的錢 */
  unpaidGuest() {
    return Sessions.list().reduce((n, s) => n + Sessions.calc(s).guestUnpaid, 0);
  },

  /* ---------- 新增 / 編輯手動帳目 ---------- */
  openAdd() { this.openEdit(null); },

  openEdit(id) {
    const t = id ? this.txns().find(x => x.id === id) : null;
    const kind = t ? t.kind : 'out';
    const cat = t ? t.cat : '買球';
    const cats = kind === 'in' ? this.IN_CATS : this.OUT_CATS;
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>${t ? '編輯帳目' : '記一筆收支'}</h2>
      <p class="hint">場地費、臨打收入、季費都會自動記帳,不用在這裡重複輸入。這裡記的是買球、贊助、聚餐這類。</p>
      <label>收 / 支</label>
      <div class="type-picker" id="tx-kind">
        <button data-kind="out" class="${kind === 'out' ? 'active' : ''}">支出</button>
        <button data-kind="in" class="${kind === 'in' ? 'active' : ''}">收入</button>
      </div>
      <label>分類</label>
      <select id="tx-cat">${cats.map(c => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <div class="field-row">
        <div><label>日期</label><input type="date" id="tx-date" value="${esc(t ? t.date : todayStr())}"></div>
        <div><label>金額(元)</label><input type="number" id="tx-amount" inputmode="numeric" value="${t ? num(t.amount) : ''}"></div>
      </div>
      <div id="tx-buy-box" class="${cat === '買球' ? '' : 'hidden'}">
        <label>球種</label>
        <select id="tx-shuttle">
          ${Shuttles.list().map(s => `<option value="${esc(s.id)}" ${t && t.shuttleId === s.id ? 'selected' : ''}>${esc(s.name)} · 一筒 ${num(s.balls)} 顆 ${money(s.price)}</option>`).join('')}
          <option value="" ${t && !t.shuttleId ? 'selected' : ''}>自訂(不從球種帶)</option>
        </select>
        <div class="field-row">
          <div><label>買幾筒</label><input type="number" id="tx-tubes" inputmode="numeric" value="${t ? num(t.tubes) : 1}"></div>
          <div><label>共幾顆</label><input type="number" id="tx-qty" inputmode="numeric" value="${t ? num(t.qty) : ''}"></div>
        </div>
        <p class="hint" id="tx-unit"></p>
      </div>
      <label>備註(選填)</label>
      <input type="text" id="tx-note" value="${esc(t ? t.note : '')}" placeholder="例如:YONEX AS-9 兩筒">
      ${t ? `
        <h3>照片 <span class="hint">(${(t.photos || []).length} 張)</span></h3>
        <p class="hint" style="margin-top:-6px">收據、贊助證明這類可以拍照存起來。</p>
        <div class="photo-grid" id="tx-photos">
          ${(t.photos || []).map(p => `<img src="${esc(Sync.photoUrl(p.id, 400))}" alt="" loading="lazy" data-pid="${esc(p.id)}">`).join('')}
        </div>
        <button class="btn block" id="tx-upload" type="button">上傳照片</button>` : ''}
      <button class="btn primary block" id="tx-save">儲存</button>
      ${t ? '<button class="btn danger block" id="tx-del">刪除這筆</button>' : ''}
    `);
    if (t) {
      document.getElementById('tx-upload').addEventListener('click', () =>
        Photos.pickAndUpload('txns', t.id, () => this.openEdit(t.id)));
      document.querySelectorAll('#tx-photos img').forEach(img =>
        img.addEventListener('click', () => Photos.openLightbox('txns', t.id, img.dataset.pid)));
    }

    const catSel = document.getElementById('tx-cat');
    const buyBox = document.getElementById('tx-buy-box');
    const shSel = document.getElementById('tx-shuttle');
    const tubes = document.getElementById('tx-tubes');
    const qty = document.getElementById('tx-qty');
    const amount = document.getElementById('tx-amount');
    const unitHint = document.getElementById('tx-unit');

    const syncQty = () => buyBox.classList.toggle('hidden', catSel.value !== '買球');
    catSel.addEventListener('change', syncQty);

    /* 選了球種就自動算金額和顆數:一筒價 × 筒數、一筒顆數 × 筒數 */
    const fillFromShuttle = () => {
      const s = Shuttles.byId(shSel.value);
      if (!s) { unitHint.textContent = '自訂:金額和顆數請自己填,顆數會算進羽球庫存。'; return; }
      const n = num(tubes.value);
      amount.value = Math.round(num(s.price) * n);
      qty.value = Math.round(num(s.balls) * n);
      unitHint.textContent = `${s.name} 單顆 ${Shuttles.unitLabel(s)} · ${n} 筒共 ${qty.value} 顆`;
    };
    shSel.addEventListener('change', fillFromShuttle);
    tubes.addEventListener('input', fillFromShuttle);
    if (!t) fillFromShuttle(); else {   // 編輯舊帳目時不要覆蓋原本輸入的金額
      const s = Shuttles.byId(shSel.value);
      unitHint.textContent = s ? `${s.name} 單顆 ${Shuttles.unitLabel(s)}` : '';
    }

    document.querySelectorAll('#tx-kind button').forEach(b =>
      b.addEventListener('click', () => {
        document.querySelectorAll('#tx-kind button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const list = b.dataset.kind === 'in' ? this.IN_CATS : this.OUT_CATS;
        catSel.innerHTML = list.map(c => `<option>${esc(c)}</option>`).join('');
        syncQty();
      }));

    document.getElementById('tx-save').addEventListener('click', () => {
      const amt = num(amount.value);
      if (!amt) { toast('請輸入金額'); return; }
      const isBuy = catSel.value === '買球';
      const rec = {
        id: t ? t.id : uid(),
        date: document.getElementById('tx-date').value || todayStr(),
        kind: document.querySelector('#tx-kind button.active').dataset.kind,
        cat: catSel.value,
        amount: amt,
        qty: isBuy ? num(qty.value) : 0,
        shuttleId: isBuy ? shSel.value : '',
        tubes: isBuy ? num(tubes.value) : 0,
        note: document.getElementById('tx-note').value.trim(),
        photos: t ? (t.photos || []) : [],   // 存檔是整包重建物件,照片要顯式帶過去才不會不見
      };
      const list = this.txns();
      const i = list.findIndex(x => x.id === rec.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
      this.saveTxns(list);
      Modal.close();
      this.render();
      toast('已儲存');
    });

    const del = document.getElementById('tx-del');
    if (del) del.addEventListener('click', async () => {
      if (!await ask('確定刪除這筆帳目?')) return;
      this.saveTxns(this.txns().filter(x => x.id !== t.id));
      Modal.close();
      this.render();
      toast('已刪除');
    });
  },
};
