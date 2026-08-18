/* 打球場次:出席、用球、場地費、每場結算 */
const Sessions = {
  filter: 'season',
  draft: null,
  guestGender: 'M',   // 臨打報到時的男/女切換,加入一位後保持不變(一群女生一起來時不用每次重切)

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
      net: guestIncome - courtFee,                          // 本場現金流
      cost: courtFee + shuttleCost,                         // 本場實際成本
      perHead: head ? (courtFee + shuttleCost) / head : 0,   // 每人成本(參考)
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
    const box = document.getElementById('session-list');
    const empty = document.getElementById('session-empty');
    const all = this.list();
    const list = all.filter(s => this.inRange(s, this.filter)).sort(byDateDesc);

    empty.classList.toggle('hidden', list.length > 0);
    empty.querySelector('p').innerHTML = all.length
      ? '這個期間還沒有打球紀錄'
      : '還沒有打球紀錄<br>按右上角「＋」記第一場';

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

  /* ---------- 新增 / 編輯 ---------- */
  openAdd() { this.openEdit(null); },

  openEdit(id) {
    const s = id ? this.byId(id) : null;
    const c = cfg();
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
      <button class="modal-close" data-close>✕</button>
      <h2>${s ? '這場紀錄' : '記一場球'}</h2>
      <div id="sess-form"></div>
    `);
    this.renderForm(!!s);
  },

  /* 把畫面上的欄位值存回 draft(重畫前一定要先呼叫,不然打到一半的字會不見) */
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
    (d.guests || []).forEach((gu, i) => {
      const el = document.getElementById('ss-gfee-' + i);
      if (el) gu.fee = num(el.value);
    });
  },

  renderForm(isEdit) {
    const d = this.draft;
    const seasonMembers = Members.active('season').sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    const calc = this.calc(d);
    const guestNames = Members.list().filter(m => m.type === 'guest').map(m => m.name);

    document.getElementById('sess-form').innerHTML = `
      <div class="field-row">
        <div><label>日期</label><input type="date" id="ss-date" value="${esc(d.date)}"></div>
        <div><label>時間</label><input type="text" id="ss-time" value="${esc(d.time)}" placeholder="19:00-22:00"></div>
      </div>
      <label>場地</label>
      <input type="text" id="ss-venue" value="${esc(d.venue)}" placeholder="例如:大同國小活動中心">
      <div class="field-row">
        <div><label>場地費(元)</label><input type="number" id="ss-court" inputmode="numeric" value="${num(d.courtFee)}"></div>
        <div><label>用掉幾顆球</label><input type="number" id="ss-shuttles" inputmode="numeric" value="${num(d.shuttles)}"></div>
      </div>

      <h3>季打出席 <span class="hint">(${calc.seasonCount}/${seasonMembers.length} 人)</span></h3>
      <div class="pick-grid" id="ss-picks">
        ${seasonMembers.length ? seasonMembers.map(m =>
          `<button class="pick ${d.attendees.includes(m.id) ? 'on' : ''}" data-id="${esc(m.id)}">${esc(m.name)}</button>`).join('')
          : '<p class="hint">還沒有季打球員,先到「人員」頁新增</p>'}
      </div>
      ${seasonMembers.length ? `<button class="link-btn" id="ss-all">${d.attendees.length === seasonMembers.length ? '全部取消' : '全部出席'}</button>` : ''}

      <h3>臨打球友 <span class="hint">(男 ${money(cfg().guestFeeM)} / 女 ${money(cfg().guestFeeF)})</span></h3>
      <div id="ss-guests">
        ${d.guests.map((g, i) => `
          <div class="guest-row">
            <span class="g-name">${esc(Members.name(g.mid))}
              <span class="chip ${genderOf(Members.byId(g.mid)) === 'F' ? 'guest' : 'off'}">${GENDER[genderOf(Members.byId(g.mid))]}</span></span>
            <input type="number" id="ss-gfee-${i}" inputmode="numeric" value="${num(g.fee)}">
            <button class="g-paid ${g.paid ? 'on' : ''}" data-i="${i}">${g.paid ? '✓ 已收' : '未收'}</button>
            <button class="g-del" data-i="${i}">✕</button>
          </div>`).join('')}
      </div>
      <div class="inline-add">
        <input type="text" id="ss-gname" list="guest-names" placeholder="臨打球友名字" autocomplete="off">
        <button class="btn small" id="ss-ggender" data-g="${this.guestGender}">${GENDER[this.guestGender]}</button>
        <button class="btn small" id="ss-gadd">＋ 加入</button>
      </div>
      <p class="hint" style="margin-top:6px">新朋友第一次來,先切男 / 女再加入,單場費會自動帶。名字打過的直接選就好。</p>
      <datalist id="guest-names">${guestNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>

      <h3>本場結算</h3>
      <div class="settle">
        <div class="settle-line"><span>臨打收入 ${calc.guestCount ? `(${d.guests.filter(g => g.paid).length} 人已收)` : ''}</span><span class="n in">+${money(calc.guestIncome)}</span></div>
        ${calc.guestUnpaid ? `<div class="settle-line"><span>臨打未收</span><span class="n out">${money(calc.guestUnpaid)}</span></div>` : ''}
        <div class="settle-line"><span>場地費</span><span class="n out">-${money(calc.courtFee)}</span></div>
        <div class="settle-line total"><span>本場公款進出</span><span class="n ${calc.net >= 0 ? 'in' : 'out'}">${calc.net >= 0 ? '+' : ''}${money(calc.net)}</span></div>
      </div>
      <p class="settle-note">出席 ${calc.head} 人,用球 ${calc.shuttles} 顆(${(() => {
        const cur = Shuttles.current();
        return cur ? `${esc(cur.name)} 每顆 ${Shuttles.unitLabel(cur)}` : `每顆 ${money(cfg().shuttlePrice)}`;
      })()},球材成本 ${money(calc.shuttleCost)},買球時已付款)。<br>
      本場實際成本 ${money(calc.cost)},平均每人 ${money(calc.perHead)}。</p>

      <label>備註(選填)</label>
      <textarea id="ss-note" placeholder="例如:今天打 3 面場地、換了新球">${esc(d.note)}</textarea>

      ${isEdit ? `
        <h3>照片 <span class="hint">(${(d.photos || []).length} 張)</span></h3>
        <div class="photo-grid" id="ss-photos">
          ${(d.photos || []).map(p => `<img src="${esc(Sync.photoUrl(p.id, 400))}" alt="" loading="lazy" data-pid="${esc(p.id)}">`).join('')}
        </div>
        <button class="btn block" id="ss-upload">📷 上傳這場的照片</button>` : ''}

      <button class="btn primary block" id="ss-save">儲存這場</button>
      ${isEdit ? '<button class="btn danger block" id="ss-del">刪除這場</button>' : ''}
    `;

    /* 季打出席切換 */
    document.querySelectorAll('#ss-picks .pick').forEach(btn =>
      btn.addEventListener('click', () => {
        this.readForm();
        const id = btn.dataset.id;
        const i = d.attendees.indexOf(id);
        if (i >= 0) d.attendees.splice(i, 1); else d.attendees.push(id);
        this.renderForm(isEdit);
      }));
    const allBtn = document.getElementById('ss-all');
    if (allBtn) allBtn.addEventListener('click', () => {
      this.readForm();
      d.attendees = d.attendees.length === seasonMembers.length ? [] : seasonMembers.map(m => m.id);
      this.renderForm(isEdit);
    });

    /* 臨打 */
    const gBtn = document.getElementById('ss-ggender');
    gBtn.addEventListener('click', () => {
      this.guestGender = gBtn.dataset.g === 'M' ? 'F' : 'M';
      gBtn.dataset.g = this.guestGender;
      gBtn.textContent = GENDER[this.guestGender];
    });
    document.getElementById('ss-gadd').addEventListener('click', () => this.addGuest(isEdit));
    document.getElementById('ss-gname').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.addGuest(isEdit); }
    });
    document.querySelectorAll('#ss-guests .g-paid').forEach(btn =>
      btn.addEventListener('click', () => {
        this.readForm();
        const g = d.guests[+btn.dataset.i];
        g.paid = !g.paid;
        this.renderForm(isEdit);
      }));
    document.querySelectorAll('#ss-guests .g-del').forEach(btn =>
      btn.addEventListener('click', () => {
        this.readForm();
        d.guests.splice(+btn.dataset.i, 1);
        this.renderForm(isEdit);
      }));

    /* 場地費 / 用球數改動要即時反映在結算 */
    ['ss-court', 'ss-shuttles'].forEach(idn =>
      document.getElementById(idn).addEventListener('change', () => {
        this.readForm();
        this.renderForm(isEdit);
      }));

    /* 照片 */
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
    if (del) del.addEventListener('click', () => {
      if (!confirm('確定刪除這場紀錄?出席、結算和照片連結都會一起刪除。')) return;
      this.saveList(this.list().filter(x => x.id !== d.id));
      Modal.close();
      this.render();
      Finance.render();
      Photos.render();
      toast('已刪除');
    });
  },

  addGuest(isEdit) {
    this.readForm();
    const input = document.getElementById('ss-gname');
    const name = input.value.trim();
    if (!name) { toast('請輸入臨打球友名字'); return; }
    const m = Members.ensureGuest(name, this.guestGender);
    if (this.draft.guests.some(g => g.mid === m.id)) { toast(`${name} 已經在名單裡了`); input.value = ''; return; }
    this.draft.guests.push({ mid: m.id, fee: guestFeeOf(m), paid: true });
    input.value = '';
    this.renderForm(isEdit);
    document.getElementById('ss-gname').focus();
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
