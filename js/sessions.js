/* 打球場次:出席、用球、場地費、每場結算
 *
 * 表單的畫法:彈窗打開時畫一次完整版面,之後勾出席、加臨打、改金額都只更新
 * 有變動的那一小塊(見 togglePick / bindGuestRow / renderSettle)。
 * 不整段重畫的原因是:重畫會讓正在輸入的欄位失焦、手機鍵盤收起來、畫面閃一下。
 */
const Sessions = {
  filter: 'season',
  draft: null,
  isEdit: false,
  guestGender: 'M',   // 臨打報到時的男/女切換,加入一位後保持不變(一群女生一起來時不用每次重切)
  unpaidOpen: false,  // 未收款橫條有沒有展開

  list() { return Store.load('sessions', []); },
  saveList(l) { Store.save('sessions', l); Sync.bg('sessions'); },
  byId(id) { return this.list().find(s => s.id === id) || null; },

  /* ---------- 每場結算 ----------
   * 季打球員的場地費已經含在季費裡,當場不再收錢;臨打球友每場收一次固定費用。
   * 球費(用球數 × 單顆成本)是「這場燒掉多少球」的成本參考,不算現金流 ——
   * 買球那筆錢在「收支」頁買球時就已經付出去了,這裡再算一次會重複記帳。
   */
  calc(s) {
    const guests = s.guests || [];
    const seasonCount = (s.attendees || []).length;
    const guestCount = guests.length;
    const head = seasonCount + guestCount;
    const guestIncome = guests.filter(g => g.paid).reduce((n, g) => n + num(g.fee), 0);
    const guestUnpaid = guests.filter(g => !g.paid).reduce((n, g) => n + num(g.fee), 0);
    const courtFee = num(s.courtFee);
    const shuttles = num(s.shuttles);
    const shuttleCost = shuttles * shuttleUnitPrice();
    return {
      seasonCount, guestCount, head,
      guestIncome, guestUnpaid, courtFee, shuttles, shuttleCost,
      net: guestIncome - courtFee,                           // 本場現金流
      cost: courtFee + shuttleCost,                          // 本場實際成本
      perHead: head ? (courtFee + shuttleCost) / head : 0,    // 每人成本(參考)
    };
  },

  inRange(s, range) {
    if (range === 'all') return true;
    if (range === 'month') return monthOf(s.date) === monthOf(todayStr());
    const season = Seasons.current();
    if (!season) return true;
    return s.date >= (season.start || '') && s.date <= (season.end || '9999');
  },

  /* ---------- 清單 ---------- */
  render() {
    this.renderUnpaid();

    const box = document.getElementById('session-list');
    const empty = document.getElementById('session-empty');
    const all = this.list();
    const list = all.filter(s => this.inRange(s, this.filter)).sort(byDateDesc);

    empty.classList.toggle('hidden', list.length > 0);
    empty.querySelector('p').innerHTML = all.length
      ? '這個期間還沒有打球紀錄'
      : '還沒有打球紀錄<br>按右下角「＋」記第一場';

    let heads = 0, net = 0, shuttles = 0;
    list.forEach(s => { const c = this.calc(s); heads += c.head; net += c.net; shuttles += c.shuttles; });
    document.getElementById('session-stats').innerHTML = `
      <div class="stat"><div class="k">場次</div><div class="v">${list.length}</div></div>
      <div class="stat"><div class="k">平均出席</div><div class="v">${list.length ? (heads / list.length).toFixed(1) : '—'}</div></div>
      <div class="stat"><div class="k">用球</div><div class="v">${shuttles}<span style="font-size:12px"> 顆</span></div></div>`;

    box.innerHTML = list.map(s => {
      const c = this.calc(s);
      const photos = (s.photos || []).length;
      return `<button class="row-card ${c.net >= 0 ? 'in-left' : 'out-left'}" data-id="${esc(s.id)}">
        <div class="row-main">
          <div class="row-title">${esc(shortDate(s.date))}
            ${s.venue ? `<span style="font-size:13px;font-weight:600">${esc(s.venue)}</span>` : ''}
            ${c.guestUnpaid ? `<span class="chip unpaid">有人未付</span>` : ''}
          </div>
          <div class="row-sub">季打 ${c.seasonCount} · 臨打 ${c.guestCount} · 用球 ${c.shuttles} 顆${s.time ? ' · ' + esc(s.time) : ''}${photos ? ' · 📷 ' + photos : ''}</div>
        </div>
        <div class="row-right">
          <div class="row-amount ${c.net >= 0 ? 'in' : 'out'}">${c.net >= 0 ? '+' : ''}${money(c.net)}</div>
          <div class="row-note">場地 ${money(c.courtFee)}</div>
        </div>
      </button>`;
    }).join('');

    box.querySelectorAll('.row-card').forEach(el =>
      el.addEventListener('click', () => this.openEdit(el.dataset.id)));
  },

  /* ---------- 未收的臨打費 ----------
   * 錢沒收到是最容易忘記的一件事,所以放在場次頁最上面,
   * 點開就能直接標「已收」,不用進場次編輯再找人。
   */
  unpaidRows() {
    const rows = [];
    this.list().forEach(s =>
      (s.guests || []).forEach(g => {
        if (!g.paid && num(g.fee) > 0) rows.push({ sid: s.id, mid: g.mid, fee: num(g.fee), date: s.date });
      }));
    return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  renderUnpaid() {
    const bar = document.getElementById('unpaid-bar');
    const listBox = document.getElementById('unpaid-list');
    if (!bar || !listBox) return;

    const rows = this.unpaidRows();
    const total = rows.reduce((n, r) => n + r.fee, 0);
    if (!rows.length) {
      bar.classList.add('hidden');
      listBox.classList.add('hidden');
      this.unpaidOpen = false;
      return;
    }

    bar.classList.remove('hidden');
    bar.classList.toggle('open', this.unpaidOpen);
    bar.innerHTML = `
      <span class="a-icon">💰</span>
      <span class="a-text">還有 ${money(total)} 臨打費沒收 · ${rows.length} 人次</span>
      <span class="a-arrow">▶</span>`;
    bar.onclick = () => {
      this.unpaidOpen = !this.unpaidOpen;
      this.renderUnpaid();
    };

    listBox.classList.toggle('hidden', !this.unpaidOpen);
    if (!this.unpaidOpen) return;

    listBox.innerHTML = rows.map(r => {
      const name = Members.name(r.mid);
      return `<div class="guest-row" data-sid="${esc(r.sid)}" data-mid="${esc(r.mid)}">
        <span class="g-name">${avatarHtml(name, 'sm')}${esc(name)}</span>
        <span class="g-when">${esc(shortDate(r.date))}</span>
        <span class="num" style="font-weight:700">${money(r.fee)}</span>
        <button class="g-paid" type="button">標記已收</button>
      </div>`;
    }).join('');

    listBox.querySelectorAll('.g-paid').forEach(btn =>
      btn.addEventListener('click', () => {
        const row = btn.closest('.guest-row');
        this.markGuestPaid(row.dataset.sid, row.dataset.mid);
      }));
  },

  markGuestPaid(sid, mid) {
    const list = this.list();
    const s = list.find(x => x.id === sid);
    if (!s) return;
    const g = (s.guests || []).find(x => x.mid === mid);
    if (!g) return;
    g.paid = true;
    this.saveList(list);
    haptic();
    toast(`已記錄:${Members.name(mid)} 收到 ${money(g.fee)}`);
    this.render();
    Finance.render();
  },

  /* ---------- 新增 / 編輯 ---------- */
  openAdd() { this.openEdit(null); },

  openEdit(id) {
    const s = id ? this.byId(id) : null;
    const c = cfg();
    this.isEdit = !!s;
    this.draft = s
      ? JSON.parse(JSON.stringify(s))
      : {
          id: uid(), date: todayStr(), venue: c.venue, time: c.time,
          courtFee: num(c.courtFee), shuttles: 0,
          attendees: [], guests: [], note: '', photos: [],
          createdAt: new Date().toISOString(),
        };
    if (!this.draft.attendees) this.draft.attendees = [];
    if (!this.draft.guests) this.draft.guests = [];

    Modal.open(`
      <button class="modal-close" data-close aria-label="關閉">✕</button>
      <h2>${s ? '這場紀錄' : '記一場球'}</h2>
      <div id="sess-form"></div>
    `);
    this.renderForm();
  },

  seasonMembers() {
    return Members.active('season').sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  },

  guestOf(mid) { return (this.draft.guests || []).find(g => g.mid === mid) || null; },

  /* 把畫面上的文字欄位存回 draft(存檔和重算結算前先呼叫) */
  readForm() {
    const d = this.draft;
    const g = idn => document.getElementById(idn);
    if (!g('ss-date')) return;
    d.date = g('ss-date').value || todayStr();
    d.venue = g('ss-venue').value.trim();
    d.time = g('ss-time').value.trim();
    d.courtFee = num(g('ss-court').value);
    d.shuttles = num(g('ss-shuttles').value);
    d.note = g('ss-note').value.trim();
    document.querySelectorAll('#ss-guests .guest-row').forEach(row => {
      const gu = this.guestOf(row.dataset.mid);
      const el = row.querySelector('.g-fee');
      if (gu && el) gu.fee = num(el.value);
    });
  },

  /* ---------- 表單:只在打開彈窗時畫一次 ---------- */
  renderForm() {
    const d = this.draft;
    const c = cfg();
    const guestNames = Members.list().filter(m => m.type === 'guest').map(m => m.name);
    const hasSeason = this.seasonMembers().length > 0;

    document.getElementById('sess-form').innerHTML = `
      <div class="field-row">
        <div><label for="ss-date">日期</label><input type="date" id="ss-date" value="${esc(d.date)}"></div>
        <div><label for="ss-time">時間</label><input type="text" id="ss-time" value="${esc(d.time)}" placeholder="19:00-22:00"></div>
      </div>
      <label for="ss-venue">場地</label>
      <input type="text" id="ss-venue" value="${esc(d.venue)}" placeholder="例如:大同國小活動中心">
      <div class="field-row">
        <div><label for="ss-court">場地費(元)</label><input type="number" id="ss-court" inputmode="numeric" value="${num(d.courtFee)}"></div>
        <div><label for="ss-shuttles">用掉幾顆球</label><input type="number" id="ss-shuttles" inputmode="numeric" value="${num(d.shuttles)}"></div>
      </div>

      <h3>季打出席 <span class="hint" id="ss-pickcount"></span></h3>
      <div class="pick-grid" id="ss-picks"></div>
      ${hasSeason ? '<button class="link-btn" id="ss-all" type="button"></button>' : ''}

      <h3>臨打球友 <span class="hint">(男 ${money(c.guestFeeM)} / 女 ${money(c.guestFeeF)})</span></h3>
      <div id="ss-guests"></div>
      <div class="inline-add">
        <input type="text" id="ss-gname" list="guest-names" placeholder="臨打球友名字" autocomplete="off">
        <button class="btn small" id="ss-ggender" type="button" data-g="${this.guestGender}">${GENDER[this.guestGender]}</button>
        <button class="btn small" id="ss-gadd" type="button">＋ 加入</button>
      </div>
      <p class="hint" style="margin-top:6px">新朋友第一次來,先切男 / 女再加入,單場費會自動帶。名字打過的直接選就好。</p>
      <datalist id="guest-names">${guestNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>

      <h3>本場結算</h3>
      <div id="ss-settle"></div>

      <label for="ss-note">備註(選填)</label>
      <textarea id="ss-note" placeholder="例如:今天打 3 面場地、換了新球">${esc(d.note)}</textarea>

      ${this.isEdit ? `
        <h3>照片 <span class="hint">(${(d.photos || []).length} 張)</span></h3>
        <div class="photo-grid" id="ss-photos">
          ${(d.photos || []).map(p => `<img src="${esc(Sync.photoUrl(p.id, 400))}" alt="" loading="lazy" data-pid="${esc(p.id)}">`).join('')}
        </div>
        <button class="btn block" id="ss-upload" type="button">📷 上傳這場的照片</button>` : ''}

      <button class="btn primary block" id="ss-save" type="button">儲存這場</button>
      ${this.isEdit ? '<button class="btn danger block" id="ss-del" type="button">刪除這場</button>' : ''}
    `;

    this.renderPicks();
    this.renderGuests();
    this.renderSettle();
    this.bindForm();
  },

  /* 只綁不會被重畫的元素 */
  bindForm() {
    const d = this.draft;

    /* 場地費 / 用球數邊打邊反映在結算 */
    ['ss-court', 'ss-shuttles'].forEach(idn =>
      document.getElementById(idn).addEventListener('input', () => {
        this.readForm();
        this.renderSettle();
      }));

    const allBtn = document.getElementById('ss-all');
    if (allBtn) allBtn.addEventListener('click', () => {
      const members = this.seasonMembers();
      d.attendees = d.attendees.length === members.length ? [] : members.map(m => m.id);
      haptic();
      this.renderPicks();
      this.renderSettle();
    });

    const gBtn = document.getElementById('ss-ggender');
    gBtn.addEventListener('click', () => {
      this.guestGender = gBtn.dataset.g === 'M' ? 'F' : 'M';
      gBtn.dataset.g = this.guestGender;
      gBtn.textContent = GENDER[this.guestGender];
    });
    document.getElementById('ss-gadd').addEventListener('click', () => this.addGuest());
    document.getElementById('ss-gname').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.addGuest(); }
    });

    const up = document.getElementById('ss-upload');
    if (up) up.addEventListener('click', () => {
      this.readForm();
      this.save(false);
      Photos.pickAndUpload(d.id, () => this.openEdit(d.id));
    });
    document.querySelectorAll('#ss-photos img').forEach(img =>
      img.addEventListener('click', () => Photos.openLightbox(d.id, img.dataset.pid)));

    document.getElementById('ss-save').addEventListener('click', () => {
      this.readForm();
      this.save(true);
      Modal.close();
      toast('已儲存這場紀錄');
    });

    const del = document.getElementById('ss-del');
    if (del) del.addEventListener('click', async () => {
      if (!await ask('確定刪除這場紀錄?\n出席、結算和照片連結都會一起刪除。')) return;
      this.saveList(this.list().filter(x => x.id !== d.id));
      Modal.close();
      this.render();
      Finance.render();
      Photos.render();
      toast('已刪除');
    });
  },

  /* ---------- 季打出席 ---------- */
  renderPicks() {
    const box = document.getElementById('ss-picks');
    const members = this.seasonMembers();
    box.innerHTML = members.length
      ? members.map(m =>
          `<button class="pick ${this.draft.attendees.includes(m.id) ? 'on' : ''}" type="button"
             data-id="${esc(m.id)}" aria-pressed="${this.draft.attendees.includes(m.id)}">${esc(m.name)}</button>`).join('')
      : '<p class="hint">還沒有季打球員,先到「人員」頁新增</p>';
    box.querySelectorAll('.pick').forEach(btn =>
      btn.addEventListener('click', () => this.togglePick(btn)));
    this.syncPickMeta();
  },

  /* 勾出席只改這顆按鈕的樣式 + 更新人數和結算,不重畫整張表單 */
  togglePick(btn) {
    const d = this.draft;
    const id = btn.dataset.id;
    const i = d.attendees.indexOf(id);
    if (i >= 0) { d.attendees.splice(i, 1); btn.classList.remove('on'); }
    else { d.attendees.push(id); btn.classList.add('on'); }
    btn.setAttribute('aria-pressed', i < 0);
    haptic();
    this.syncPickMeta();
    this.renderSettle();
  },

  syncPickMeta() {
    const members = this.seasonMembers();
    const cnt = document.getElementById('ss-pickcount');
    if (cnt) cnt.textContent = `(${this.draft.attendees.length}/${members.length} 人)`;
    const all = document.getElementById('ss-all');
    if (all) all.textContent =
      members.length && this.draft.attendees.length === members.length ? '全部取消' : '全部出席';
  },

  /* ---------- 臨打球友 ---------- */
  guestRowHtml(g) {
    const m = Members.byId(g.mid);
    const name = Members.name(g.mid);
    const gender = genderOf(m);
    return `<div class="guest-row" data-mid="${esc(g.mid)}">
      <span class="g-name">${avatarHtml(name, 'sm')}${esc(name)}
        <span class="chip ${gender === 'F' ? 'guest' : 'off'}">${GENDER[gender]}</span></span>
      <input type="number" class="g-fee" inputmode="numeric" value="${num(g.fee)}" aria-label="${esc(name)} 單場費">
      <button class="g-paid ${g.paid ? 'on' : ''}" type="button">${g.paid ? '✓ 已收' : '未收'}</button>
      <button class="g-del" type="button" aria-label="移除 ${esc(name)}">✕</button>
    </div>`;
  },

  renderGuests() {
    const box = document.getElementById('ss-guests');
    box.innerHTML = this.draft.guests.map(g => this.guestRowHtml(g)).join('');
    box.querySelectorAll('.guest-row').forEach(row => this.bindGuestRow(row));
  },

  bindGuestRow(row) {
    const mid = row.dataset.mid;

    row.querySelector('.g-fee').addEventListener('input', e => {
      const g = this.guestOf(mid);
      if (g) g.fee = num(e.target.value);
      this.renderSettle();
    });

    row.querySelector('.g-paid').addEventListener('click', e => {
      const g = this.guestOf(mid);
      if (!g) return;
      g.paid = !g.paid;
      const b = e.currentTarget;
      b.classList.toggle('on', g.paid);
      b.textContent = g.paid ? '✓ 已收' : '未收';
      haptic();
      this.renderSettle();
    });

    row.querySelector('.g-del').addEventListener('click', () => {
      this.draft.guests = this.draft.guests.filter(x => x.mid !== mid);
      row.remove();
      this.renderSettle();
    });
  },

  addGuest() {
    const input = document.getElementById('ss-gname');
    const name = input.value.trim();
    if (!name) { toast('請輸入臨打球友名字'); return; }
    const m = Members.ensureGuest(name, this.guestGender);
    if (this.draft.guests.some(g => g.mid === m.id)) { toast(`${name} 已經在名單裡了`); input.value = ''; return; }

    const g = { mid: m.id, fee: guestFeeOf(m), paid: true };
    this.draft.guests.push(g);

    const box = document.getElementById('ss-guests');
    box.insertAdjacentHTML('beforeend', this.guestRowHtml(g));
    this.bindGuestRow(box.lastElementChild);

    /* 剛建的新球友也要能在下次輸入時被選到 */
    const dl = document.getElementById('guest-names');
    if (dl && !dl.querySelector(`option[value="${CSS.escape(m.name)}"]`)) {
      dl.insertAdjacentHTML('beforeend', `<option value="${esc(m.name)}">`);
    }

    input.value = '';
    input.focus();
    haptic();
    this.renderSettle();
  },

  /* ---------- 結算(唯一會反覆重畫的區塊,裡面沒有要綁事件的東西) ---------- */
  renderSettle() {
    const d = this.draft;
    const calc = this.calc(d);
    const cur = Shuttles.current();
    const unit = cur ? `${esc(cur.name)} 每顆 ${Shuttles.unitLabel(cur)}` : `每顆 ${money(cfg().shuttlePrice)}`;

    document.getElementById('ss-settle').innerHTML = `
      <div class="settle">
        <div class="settle-line"><span>臨打收入 ${calc.guestCount ? `(${d.guests.filter(g => g.paid).length} 人已收)` : ''}</span><span class="n in">+${money(calc.guestIncome)}</span></div>
        ${calc.guestUnpaid ? `<div class="settle-line"><span>臨打未收</span><span class="n out">${money(calc.guestUnpaid)}</span></div>` : ''}
        <div class="settle-line"><span>場地費</span><span class="n out">-${money(calc.courtFee)}</span></div>
        <div class="settle-line total"><span>本場公款進出</span><span class="n ${calc.net >= 0 ? 'in' : 'out'}">${calc.net >= 0 ? '+' : ''}${money(calc.net)}</span></div>
      </div>
      <p class="settle-note">出席 ${calc.head} 人,用球 ${calc.shuttles} 顆(${unit},球材成本 ${money(calc.shuttleCost)},買球時已付款)。<br>
      本場實際成本 ${money(calc.cost)},平均每人 ${money(calc.perHead)}。</p>`;
  },

  /* redraw=false 用在「先存檔再上傳照片」,不重畫畫面 */
  save(redraw = true) {
    const d = this.draft;
    const list = this.list();
    const i = list.findIndex(x => x.id === d.id);
    if (i >= 0) list[i] = d; else list.push(d);
    this.saveList(list);
    if (redraw) {
      this.render();
      Members.render();
      Finance.render();
      Photos.render();
    }
  },
};
