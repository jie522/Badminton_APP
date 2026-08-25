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
  unpaidOpen: false,     // 未收款橫條有沒有展開
  unsettledOpen: false,  // 未結算橫條有沒有展開
  gsugOpen: false,       // 臨打名字的下拉選單開著沒(輸入框有焦點時就開)
  MAX_HEAD: 8,        // 每場出席上限(季打 + 臨打合計),場地一次只夠這麼多人

  list() { return Store.load('sessions', []); },
  saveList(l) { Store.save('sessions', l); Sync.bg('sessions'); },
  byId(id) { return this.list().find(s => s.id === id) || null; },

  /* 這場的錢確認完了沒(冷氣費 + 臨打費)。存在紀錄上的 settled 欄位,不是畫面暫存,
   * 所以關掉再打開還記得。舊資料沒有這個欄位(在還沒有「結算這場」之前記的),
   * 一律當成已結算 —— 只有明確是 false 才叫未結算。 */
  isSettled(s) { return !s || s.settled !== false; },

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
    const courtFee = num(s.courtFee);   // 舊制場地費,新場次固定 0(場地費已改季繳,見 store.js 的欄位註解)
    const acFee = num(s.acFee);         // 冷氣費,現在每場的設施費用
    /* 用球分球種記:各算各的單顆成本再加總 */
    const use = (s.shuttleUse || []).filter(u => num(u.n) > 0);
    const shuttles = use.reduce((n, u) => n + num(u.n), 0);
    const shuttleCost = use.reduce((n, u) => n + num(u.n) * Shuttles.unitPriceOf(u.sid), 0);
    return {
      seasonCount, guestCount, head,
      guestIncome, guestUnpaid, courtFee, acFee, use, shuttles, shuttleCost,
      net: guestIncome - courtFee - acFee,                           // 本場現金流
      cost: courtFee + acFee + shuttleCost,                          // 本場實際成本
      perHead: head ? (courtFee + acFee + shuttleCost) / head : 0,   // 每人成本(參考)
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
    this.renderUnsettled();
    this.renderUnpaid();

    const box = document.getElementById('session-list');
    const empty = document.getElementById('session-empty');
    const all = this.list();
    const list = all.filter(s => this.inRange(s, this.filter)).sort(byDateDesc);

    empty.classList.toggle('hidden', list.length > 0);
    /* 有紀錄卻被篩選擋掉時,要講清楚是哪個期間在擋 ——
     * 不然「剛記完一場卻看不到」會以為資料不見了(季別已經結束時最常遇到) */
    const season = Seasons.current();
    empty.querySelector('p').innerHTML = !all.length
      ? '還沒有打球紀錄<br>按右下角「＋」記第一場'
      : this.filter === 'season' && season
        ? `${esc(season.name)}(${esc(season.start || '')} ~ ${esc(season.end || '')})沒有打球紀錄<br>
           這個球季以外的紀錄,切到「全部」就看得到`
        : this.filter === 'month'
          ? '這個月還沒有打球紀錄<br>切到「全部」看看以前的'
          : '這個期間還沒有打球紀錄';

    let heads = 0, net = 0, shuttles = 0;
    list.forEach(s => { const c = this.calc(s); heads += c.head; net += c.net; shuttles += c.shuttles; });
    document.getElementById('session-stats').innerHTML = `
      <div class="stat"><div class="k">場次</div><div class="v">${list.length}</div></div>
      <div class="stat"><div class="k">平均出席</div><div class="v">${list.length ? (heads / list.length).toFixed(1) : '—'}</div></div>
      <div class="stat"><div class="k">用球</div><div class="v">${shuttles}<span style="font-size:12px"> 顆</span></div></div>`;

    box.innerHTML = list.map(s => {
      const c = this.calc(s);
      const photos = (s.photos || []).length;
      const d = dateParts(s.date);
      const cover = (s.photos || [])[0];
      /* 有照片就用第一張當縮圖取代日期方塊(比日期好認出是哪一場),
       * 日期改插進標題左邊,不會因為換了縮圖就找不到是哪天;讀不到照片時退回日期方塊。 */
      const leftTile = cover
        ? `<img class="date-tile session-thumb" src="${esc(Sync.photoUrl(cover.id, 120))}" alt="" loading="lazy"
             onerror="Sessions.thumbFallback(this, ${esc(JSON.stringify(d.md))}, ${esc(JSON.stringify(d.wd))})">`
        : `<div class="date-tile"><b>${esc(d.md)}</b><span>${esc(d.wd)}</span></div>`;
      /* 未結算的場次整張卡片標出來(左邊警示色帶 + 有顏色的徽章),
       * 原本只有一個灰色小徽章,在一長串紀錄裡幾乎看不到 */
      return `<button class="row-card${this.isSettled(s) ? '' : ' warn-left'}" data-id="${esc(s.id)}">
        ${leftTile}
        <div class="row-main">
          <div class="row-title">${cover ? `<span class="row-date">${esc(d.md)}</span>` : ''}${esc(s.venue || '打球')}
            ${c.guestUnpaid ? `<span class="chip unpaid">有人未付</span>` : ''}
            ${this.isSettled(s) ? '' : `<span class="chip pending">${icon('wallet', '', 11)}未結算</span>`}
          </div>
          <div class="row-sub">季打 ${c.seasonCount} · 臨打 ${c.guestCount} · 用球 ${c.shuttles} 顆${c.use.length > 1 ? `(${c.use.length} 種)` : ''}${s.time ? ' · ' + esc(s.time) : ''}${photos ? ' · 照片 ' + photos : ''}</div>
        </div>
        <div class="row-right">
          <div class="row-amount ${c.net >= 0 ? 'in' : 'out'}">${c.net >= 0 ? '+' : ''}${money(c.net)}</div>
          <div class="row-note">${[c.courtFee ? '場地 ' + money(c.courtFee) : '', c.acFee ? '冷氣 ' + money(c.acFee) : ''].filter(Boolean).join(' · ')}</div>
        </div>
      </button>`;
    }).join('');

    box.querySelectorAll('.row-card').forEach(el =>
      el.addEventListener('click', () => this.openEdit(el.dataset.id)));
  },

  /* 場次卡左邊的縮圖 <img onerror> 讀不到照片時呼叫這個,換回日期方塊 */
  thumbFallback(img, md, wd) {
    const div = document.createElement('div');
    div.className = 'date-tile';
    const b = document.createElement('b'); b.textContent = md;
    const span = document.createElement('span'); span.textContent = wd;
    div.append(b, span);
    img.replaceWith(div);
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

  /* ---------- 還沒結算的場次 ----------
   * 「結算這場」按了沒,原本只靠卡片上一個灰色小徽章,滑過去很容易漏掉。
   * 比照「有人未付」的做法,在場次頁最上面放一條可展開的提示條:
   * 有幾場沒結算、點開列出來、直接開那一場去按結算。
   * 判斷一律走 isSettled()(只有明確是 false 才算未結算),
   * 舊場次沒有這個欄位,一律當已結算,不然整份歷史紀錄會全部跑進這裡。
   */
  unsettledRows() {
    return this.list().filter(s => !this.isSettled(s)).sort(byDateDesc);
  },

  renderUnsettled() {
    const bar = document.getElementById('unsettled-bar');
    const listBox = document.getElementById('unsettled-list');
    if (!bar || !listBox) return;

    const rows = this.unsettledRows();
    if (!rows.length) {
      bar.classList.add('hidden');
      listBox.classList.add('hidden');
      this.unsettledOpen = false;
      return;
    }

    bar.classList.remove('hidden');
    bar.classList.toggle('open', this.unsettledOpen);
    bar.innerHTML = `
      <span class="a-icon">${icon('wallet', '', 18)}</span>
      <span class="a-text">還有 ${rows.length} 場沒結算</span>
      <span class="a-arrow">${icon('chevron', '', 16)}</span>`;
    bar.onclick = () => {
      this.unsettledOpen = !this.unsettledOpen;
      this.renderUnsettled();
    };

    listBox.classList.toggle('hidden', !this.unsettledOpen);
    if (!this.unsettledOpen) return;

    listBox.innerHTML = rows.map(s => {
      const c = this.calc(s);
      return `<div class="guest-row" data-id="${esc(s.id)}">
        <span class="g-name"><span class="g-nm">${esc(shortDate(s.date))} ${esc(s.venue || '打球')}</span></span>
        <span class="g-when">${c.head} 人</span>
        <button class="g-paid" type="button">去結算</button>
      </div>`;
    }).join('');

    listBox.querySelectorAll('.g-paid').forEach(btn =>
      btn.addEventListener('click', () => this.openEdit(btn.closest('.guest-row').dataset.id)));
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
      <span class="a-icon">${icon('coins', '', 18)}</span>
      <span class="a-text">還有 ${money(total)} 臨打費沒收 · ${rows.length} 人次</span>
      <span class="a-arrow">${icon('chevron', '', 16)}</span>`;
    bar.onclick = () => {
      this.unpaidOpen = !this.unpaidOpen;
      this.renderUnpaid();
    };

    listBox.classList.toggle('hidden', !this.unpaidOpen);
    if (!this.unpaidOpen) return;

    listBox.innerHTML = rows.map(r => {
      const gm = Members.byId(r.mid);
      const name = gm ? gm.name : '(已刪除)';
      return `<div class="guest-row" data-sid="${esc(r.sid)}" data-mid="${esc(r.mid)}">
        <span class="g-name">${avatarHtml(name, 'sm', gm && gm.avatarId)}<span class="g-nm">${esc(name)}</span></span>
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

  /* presetDate:從行事曆點某一天進來時帶的日期(見 Seasons.renderDayPanel),
   * 沒帶就照原本的規則預設下一個週五 */
  openEdit(id, presetDate) {
    const s = id ? this.byId(id) : null;
    const c = cfg();
    this.isEdit = !!s;
    this.draft = s
      ? JSON.parse(JSON.stringify(s))
      : {
          id: uid(), date: presetDate || nextFriday(), venue: c.venue, time: c.time,
          courtFee: 0, acFee: num(c.acFee), shuttleUse: [],   // 場地費已改季繳,新場次固定 0
          attendees: [], guests: [], note: '', photos: [], settled: false,
          createdAt: new Date().toISOString(),
        };
    if (!this.draft.attendees) this.draft.attendees = [];
    if (!this.draft.guests) this.draft.guests = [];
    if (!this.draft.shuttleUse) this.draft.shuttleUse = [];
    /* 這場「原本」用了幾顆:算即時庫存時要先扣掉,不然編輯舊場次會被自己重複扣一次 */
    this.savedUse = {};
    ((s && s.shuttleUse) || []).forEach(u => { this.savedUse[u.sid || ''] = num(u.n); });

    Modal.open(`
      <button class="modal-close" data-close aria-label="關閉">✕</button>
      <div class="sess-head">
        <h2>${s ? '場次紀錄' : '記一場球'}</h2>
        <span class="sess-net" id="ss-net-badge"></span>
      </div>
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
    if (g('ss-court')) d.courtFee = num(g('ss-court').value);   // 只有舊資料(courtFee>0)才會有這個欄位
    d.acFee = num(g('ss-ac').value);
    d.note = g('ss-note').value.trim();
    document.querySelectorAll('#ss-use .use-row').forEach(row =>
      this.setUse(row.dataset.sid, row.querySelector('.u-n').value));
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
    const hasSeason = this.seasonMembers().length > 0;

    document.getElementById('sess-form').innerHTML = `
      <div class="field-row">
        <div><label for="ss-date">日期</label><input type="date" id="ss-date" value="${esc(d.date)}"></div>
        <div><label for="ss-time">時間</label><input type="text" id="ss-time" value="${esc(d.time)}" placeholder="19:00-22:00"></div>
      </div>
      <label for="ss-venue">場地</label>
      <input type="text" id="ss-venue" value="${esc(d.venue)}" placeholder="例如:大同國小活動中心">
      ${num(d.courtFee) > 0 ? `
      <label for="ss-court">場地費(元)</label>
      <input type="number" id="ss-court" inputmode="numeric" value="${num(d.courtFee)}">
      <p class="hint" style="margin-top:-6px">舊資料。場地費已改季繳,新場次不會再收這筆,這裡只是保留這場當時的紀錄。</p>` : ''}
      <label for="ss-ac">冷氣費(元)</label>
      <input type="number" id="ss-ac" inputmode="numeric" value="${num(d.acFee)}">

      <div class="form-section">
        <h3>用球 <span class="hint" id="ss-usecount"></span></h3>
        <div id="ss-use"></div>
        <p class="hint" style="margin-top:6px">每種球分開記,各自算成本、各自扣庫存。<span id="ss-use-tip"></span></p>
      </div>

      <div class="form-section">
        <h3>季打出席 <span class="hint" id="ss-pickcount"></span></h3>
        <p class="hint" id="ss-cap-tip"></p>
        <div class="pick-grid" id="ss-picks"></div>
        ${hasSeason ? '<button class="link-btn" id="ss-all" type="button"></button>' : ''}

        <h3>臨打球友 <span class="hint">(男 ${money(c.guestFeeM)} / 女 ${money(c.guestFeeF)})</span></h3>
        <div id="ss-guests"></div>
        <div class="inline-add">
          <input type="text" id="ss-gname" placeholder="打名字找人,或直接新增" autocomplete="off">
          <button class="btn small" id="ss-ggender" type="button" data-g="${this.guestGender}">${GENDER[this.guestGender]}</button>
          <button class="btn small" id="ss-gadd" type="button">＋ 加入</button>
        </div>
        <div class="sug-list hidden" id="ss-gsug"></div>
      </div>

      <div class="form-section settle-section">
        <h3>本場結算</h3>
        <div id="ss-settle"></div>
      </div>

      <label for="ss-note">備註(選填)</label>
      <textarea id="ss-note" placeholder="例如:今天打 3 面場地、換了新球">${esc(d.note)}</textarea>

      ${this.isEdit ? `
        <div class="form-section">
          <h3>照片 <span class="hint">(${(d.photos || []).length} 張)</span></h3>
          <div class="photo-grid" id="ss-photos">
            ${(d.photos || []).map(p => `<img src="${esc(Sync.photoUrl(p.id, 400))}" alt="" loading="lazy" data-pid="${esc(p.id)}">`).join('')}
          </div>
          <button class="btn block" id="ss-upload" type="button">${icon('camera', '', 16)} 上傳這場的照片</button>
        </div>` : ''}

      <button class="btn primary block" id="ss-save" type="button">儲存這場</button>
      ${this.isEdit ? '<button class="btn danger block" id="ss-del" type="button">刪除這場</button>' : ''}
    `;

    this.renderPicks();
    this.renderGuests();
    this.renderUse();
    this.renderSettle();
    this.bindForm();
  },

  /* 只綁不會被重畫的元素 */
  bindForm() {
    const d = this.draft;

    /* 場地費(舊資料才有這個欄位)/ 冷氣費邊打邊反映在結算 */
    const court = document.getElementById('ss-court');
    if (court) court.addEventListener('input', () => { this.readForm(); this.invalidateSettle(); });
    document.getElementById('ss-ac').addEventListener('input', () => { this.readForm(); this.invalidateSettle(); });

    const allBtn = document.getElementById('ss-all');
    if (allBtn) allBtn.addEventListener('click', () => {
      const members = this.seasonMembers();
      const turningOn = d.attendees.length !== members.length;
      if (turningOn && members.length + d.guests.length > this.MAX_HEAD) {
        toast(`全部出席會超過每場 ${this.MAX_HEAD} 位上限,請個別勾選`);
        return;
      }
      d.attendees = turningOn ? members.map(m => m.id) : [];
      haptic();
      this.renderPicks();
      this.renderSettle();
    });

    const gBtn = document.getElementById('ss-ggender');
    gBtn.addEventListener('click', () => {
      this.guestGender = gBtn.dataset.g === 'M' ? 'F' : 'M';
      gBtn.dataset.g = this.guestGender;
      gBtn.textContent = GENDER[this.guestGender];
      this.renderGuestSuggest();   // 「新增這個人」那列要跟著換男/女和單場費
    });
    document.getElementById('ss-gadd').addEventListener('click', () => this.addGuest());

    const gName = document.getElementById('ss-gname');
    gName.addEventListener('focus', () => { this.gsugOpen = true; this.renderGuestSuggest(); });
    gName.addEventListener('input', () => { this.gsugOpen = true; this.renderGuestSuggest(); });
    gName.addEventListener('blur', () => {
      /* 點清單那一下是 mousedown(見 renderGuestSuggest),blur 之後才收起來不影響選取 */
      setTimeout(() => { this.gsugOpen = false; this.renderGuestSuggest(); }, 120);
    });
    gName.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        /* 打了字剛好只剩一個人符合 → 直接加他,不用再點一下 */
        const hits = this.guestCandidates(gName.value);
        if (gName.value.trim() && hits.length === 1) this.addGuestById(hits[0].m.id);
        else this.addGuest();
      }
      if (e.key === 'Escape') { this.gsugOpen = false; this.renderGuestSuggest(); }
    });

    const up = document.getElementById('ss-upload');
    if (up) up.addEventListener('click', () => {
      this.readForm();
      this.save(false);
      Photos.pickAndUpload('sessions', d.id, () => this.openEdit(d.id));
    });
    document.querySelectorAll('#ss-photos img').forEach(img =>
      img.addEventListener('click', () => Photos.openLightbox('sessions', d.id, img.dataset.pid)));

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
             data-id="${esc(m.id)}" aria-pressed="${this.draft.attendees.includes(m.id)}">
             ${avatarHtml(m.name, 'xs', m.avatarId)}<span class="p-nm">${esc(m.name)}</span></button>`).join('')
      : '<p class="hint">還沒有季打球員,先到「人員」頁新增</p>';
    box.querySelectorAll('.pick').forEach(btn =>
      btn.addEventListener('click', () => this.togglePick(btn)));
    this.syncPickMeta();
    this.syncCap();
  },

  /* 勾出席只改這顆按鈕的樣式 + 更新人數和結算,不重畫整張表單 */
  togglePick(btn) {
    const d = this.draft;
    const id = btn.dataset.id;
    const i = d.attendees.indexOf(id);
    if (i >= 0) {
      d.attendees.splice(i, 1); btn.classList.remove('on');
    } else {
      if (this.headCount() >= this.MAX_HEAD) { toast(`每場最多 ${this.MAX_HEAD} 位,已達上限`); return; }
      d.attendees.push(id); btn.classList.add('on');
    }
    btn.setAttribute('aria-pressed', i < 0);
    haptic();
    this.syncPickMeta();
    this.syncCap();
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

  /* ---------- 每場出席上限(季打 + 臨打合計) ---------- */
  headCount() { return this.draft.attendees.length + this.draft.guests.length; },

  /* 達到上限時擋住季打勾選鈕(還沒勾的)和臨打「加入」,不重畫整段只切換 disabled */
  syncCap() {
    const total = this.headCount();
    const full = total >= this.MAX_HEAD;
    const tip = document.getElementById('ss-cap-tip');
    if (tip) {
      tip.textContent = full
        ? `本場出席 ${total}/${this.MAX_HEAD} 人,已達上限(要加人請先移除其他人)`
        : `本場出席 ${total}/${this.MAX_HEAD} 人`;
      tip.style.color = full ? 'var(--out)' : '';
    }
    document.querySelectorAll('#ss-picks .pick').forEach(btn => {
      btn.disabled = full && !btn.classList.contains('on');
    });
    const gname = document.getElementById('ss-gname');
    const gadd = document.getElementById('ss-gadd');
    if (gname) gname.disabled = full;
    if (gadd) gadd.disabled = full;
  },

  /* ---------- 用球(每種球分開記) ---------- */
  useOf(sid) {
    const u = (this.draft.shuttleUse || []).find(x => (x.sid || '') === (sid || ''));
    return u ? num(u.n) : 0;
  },

  setUse(sid, n) {
    sid = sid || '';
    n = Math.max(0, Math.round(num(n)));
    const use = this.draft.shuttleUse;
    const i = use.findIndex(u => (u.sid || '') === sid);
    if (n <= 0) { if (i >= 0) use.splice(i, 1); }
    else if (i >= 0) use[i].n = n;
    else use.push({ sid, n });
  },

  /* 即時庫存:已存檔的庫存 + 這場原本用掉的 − 現在表單上填的
   * (編輯舊場次時,那幾顆已經扣過了,不先加回來會被扣兩次) */
  liveLeft(sid) {
    sid = sid || '';
    return Shuttles.stockOf(sid) + (this.savedUse[sid] || 0) - this.useOf(sid);
  },

  useRowHtml(o) {
    const n = this.useOf(o.sid);
    const left = this.liveLeft(o.sid);
    const logo = o.photoId
      ? `<img class="u-logo" src="${esc(Sync.photoUrl(o.photoId, 100))}" alt="" loading="lazy"
           onerror="Shuttles.rowLogoFallback(this)">`
      : `<div class="u-logo icon-only">${icon('shuttle', '', 18)}</div>`;
    return `<div class="use-row ${n > 0 ? 'on' : ''}" data-sid="${esc(o.sid)}">
      ${logo}
      <div class="u-main">
        <div class="u-name">${esc(o.name)}</div>
        <div class="u-sub">每顆 ${Shuttles.priceLabel(o.unit)} · <span class="u-left ${left < 0 ? 'out' : ''}">剩 ${left} 顆</span></div>
      </div>
      <div class="stepper">
        <button class="u-minus" type="button" aria-label="${esc(o.name)} 減少一顆">−</button>
        <input class="u-n" type="number" inputmode="numeric" min="0" value="${n}" aria-label="${esc(o.name)} 用了幾顆">
        <button class="u-plus" type="button" aria-label="${esc(o.name)} 增加一顆">＋</button>
      </div>
    </div>`;
  },

  renderUse() {
    const box = document.getElementById('ss-use');
    /* 庫存用完的球種不列出來(避免選到沒球可用的),但這場本來就記過的
     * (useOf > 0)還是要留著,不然沒辦法改數量或移除;「未指定球種」不受此限,
     * 沒登記任何球種時它是唯一能記用球的選項,不能因為沒有庫存概念就被濾掉。 */
    const registered = new Set(Shuttles.list().map(s => s.id));
    const opts = Shuttles.optionsFor(this.draft.shuttleUse).filter(o =>
      !registered.has(o.sid) || this.useOf(o.sid) > 0 || this.liveLeft(o.sid) > 0);
    box.innerHTML = opts.map(o => this.useRowHtml(o)).join('');
    box.querySelectorAll('.use-row').forEach(row => this.bindUseRow(row));

    const tip = document.getElementById('ss-use-tip');
    if (tip) tip.innerHTML = Shuttles.list().length
      ? ''
      : '還沒登記球種,先到「設定 → 羽球管理」加一種,才算得出球錢和庫存。';
    this.syncUseMeta();
  },

  bindUseRow(row) {
    const sid = row.dataset.sid;
    const input = row.querySelector('.u-n');

    const apply = n => {
      this.setUse(sid, n);
      input.value = this.useOf(sid);
      this.afterUseChange(row, sid);
    };
    row.querySelector('.u-minus').addEventListener('click', () => { apply(this.useOf(sid) - 1); haptic(); });
    row.querySelector('.u-plus').addEventListener('click', () => { apply(this.useOf(sid) + 1); haptic(); });
    input.addEventListener('input', () => {
      this.setUse(sid, input.value);
      this.afterUseChange(row, sid);
    });
  },

  /* 只更新這一列的庫存字樣 + 上面的小計和結算,不重畫整段(避免輸入中失焦) */
  afterUseChange(row, sid) {
    const n = this.useOf(sid);
    const left = this.liveLeft(sid);
    row.classList.toggle('on', n > 0);
    const el = row.querySelector('.u-left');
    el.textContent = `剩 ${left} 顆`;
    el.classList.toggle('out', left < 0);
    this.syncUseMeta();
    this.renderSettle();
  },

  syncUseMeta() {
    const el = document.getElementById('ss-usecount');
    if (!el) return;
    const c = this.calc(this.draft);
    el.textContent = c.shuttles
      ? `(共 ${c.shuttles} 顆 · 球材 ${money(c.shuttleCost)})`
      : '(還沒記)';
  },

  /* ---------- 臨打球友 ---------- */
  guestRowHtml(g) {
    const m = Members.byId(g.mid);
    const name = Members.name(g.mid);
    const gender = genderOf(m);
    return `<div class="guest-row" data-mid="${esc(g.mid)}">
      <span class="g-name">${avatarHtml(name, 'sm', m && m.avatarId)}<span class="g-nm">${esc(name)}</span>
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
      this.invalidateSettle();
    });

    row.querySelector('.g-paid').addEventListener('click', e => {
      const g = this.guestOf(mid);
      if (!g) return;
      g.paid = !g.paid;
      const b = e.currentTarget;
      b.classList.toggle('on', g.paid);
      b.textContent = g.paid ? '✓ 已收' : '未收';
      haptic();
      this.invalidateSettle();
    });

    row.querySelector('.g-del').addEventListener('click', () => {
      this.draft.guests = this.draft.guests.filter(x => x.mid !== mid);
      row.remove();
      this.syncCap();
      this.invalidateSettle();
    });
  },

  /* ---------- 臨打名字的下拉選單 ----------
   * 原本只有 <datalist>:手機上不一定叫得出來,叫出來也不知道這個名字是誰(沒有性別、沒有來過幾次)。
   * 改成自己畫的建議清單 —— 點輸入框就列出常來的人(來過越多次排越前面),
   * 打字用 Members.matchesQuery() 篩選(名字 / 電話 / 備註都比對得到),點一下就加入。
   * 已經在這場名單裡的人不會出現,不用擔心重複加。
   */
  guestCandidates(q) {
    const counts = {};
    this.list().forEach(s => (s.guests || []).forEach(g => { counts[g.mid] = (counts[g.mid] || 0) + 1; }));
    const taken = new Set(this.draft.guests.map(g => g.mid));
    const key = String(q || '').trim().toLowerCase();
    return Members.list()
      .filter(m => m.type === 'guest' && m.active !== false && !taken.has(m.id))
      .filter(m => !key || Members.matchesQuery(m, key))
      .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.name.localeCompare(b.name, 'zh-Hant'))
      .map(m => ({ m, times: counts[m.id] || 0 }));
  },

  renderGuestSuggest() {
    const box = document.getElementById('ss-gsug');
    const input = document.getElementById('ss-gname');
    if (!box || !input) return;
    const q = input.value.trim();
    if (!this.gsugOpen) { box.classList.add('hidden'); box.innerHTML = ''; return; }

    const rows = this.guestCandidates(q).slice(0, 8);
    /* 打的名字在名單裡找不到 → 給一列「新增這個人」,不用再去按旁邊的「加入」 */
    const exact = q && Members.list().some(m => m.name.trim() === q);
    const newRow = q && !exact
      ? `<button class="sug-row new" type="button" data-new="1">
           <span class="sug-plus">${icon('plus', '', 16)}</span>
           <span class="sug-nm">新增「${esc(q)}」為臨打球友</span>
           <span class="sug-meta">${GENDER[this.guestGender]} ${money(this.guestGender === 'F' ? cfg().guestFeeF : cfg().guestFeeM)}</span>
         </button>`
      : '';

    if (!rows.length && !newRow) {
      box.classList.remove('hidden');
      box.innerHTML = `<p class="hint" style="margin:0;padding:8px 10px">${q ? '找不到符合的臨打球友' : '還沒有臨打球友,直接打名字新增'}</p>`;
      return;
    }

    box.classList.remove('hidden');
    box.innerHTML = rows.map(({ m, times }) => `
      <button class="sug-row" type="button" data-mid="${esc(m.id)}">
        ${avatarHtml(m.name, 'sm', m.avatarId)}
        <span class="sug-nm">${esc(m.name)}</span>
        <span class="chip ${genderOf(m) === 'F' ? 'guest' : 'off'}">${GENDER[genderOf(m)]}</span>
        <span class="sug-meta">${times ? `來過 ${times} 次 · ` : ''}${money(guestFeeOf(m))}</span>
      </button>`).join('') + newRow;

    box.querySelectorAll('.sug-row').forEach(el =>
      /* 用 mousedown + preventDefault:直接綁 click 的話,手指離開輸入框時會先觸發 blur
       * 把清單收起來,那一下就點空了 */
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        if (el.dataset.new) this.addGuest();
        else this.addGuestById(el.dataset.mid);
      }));
  },

  /* 從下拉選單挑一位已經在名單裡的臨打球友加進這場 */
  addGuestById(mid) {
    const m = Members.byId(mid);
    if (!m) return;
    if (this.headCount() >= this.MAX_HEAD) { toast(`每場最多 ${this.MAX_HEAD} 位,已達上限`); return; }
    if (this.draft.guests.some(g => g.mid === m.id)) { toast(`${m.name} 已經在名單裡了`); return; }
    this.pushGuest(m);
  },

  addGuest() {
    const input = document.getElementById('ss-gname');
    const name = input.value.trim();
    if (!name) { toast('請輸入臨打球友名字'); return; }
    if (this.headCount() >= this.MAX_HEAD) { toast(`每場最多 ${this.MAX_HEAD} 位,已達上限`); return; }
    const m = Members.ensureGuest(name, this.guestGender);
    if (this.draft.guests.some(g => g.mid === m.id)) { toast(`${name} 已經在名單裡了`); input.value = ''; return; }
    this.pushGuest(m);
  },

  /* 加一位臨打進 draft 並補上那一列(不整段重畫,正在輸入的欄位不會失焦) */
  pushGuest(m) {
    /* 新加入的臨打球友預設未收:報到時通常還沒付錢,收到才手動標記 */
    const g = { mid: m.id, fee: guestFeeOf(m), paid: false };
    this.draft.guests.push(g);

    const box = document.getElementById('ss-guests');
    box.insertAdjacentHTML('beforeend', this.guestRowHtml(g));
    this.bindGuestRow(box.lastElementChild);

    const input = document.getElementById('ss-gname');
    input.value = '';
    input.focus();
    haptic();
    this.renderGuestSuggest();   // 剛加進來的人要從清單上消失
    this.syncCap();
    this.invalidateSettle();
  },

  /* ---------- 結算(唯一會反覆重畫的區塊,裡面沒有要綁事件的東西) ----------
   * 冷氣費和臨打費不是邊填邊自動算好——按過「結算」才會顯示金額,不然球還沒收完錢、
   * 冷氣費還沒填就先看到一個會一直跳動的數字,反而搞不清楚現在是不是最終結果。
   * 改冷氣費 / 臨打金額 / 已收未收 / 加人刪人都會呼叫 invalidateSettle() 把這個收起來,
   * 要重新按一次才會顯示;季打出席和用球顆數不影響這兩筆錢,所以不用重按。
   * 結不結算是記在 draft.settled 上、跟著「儲存這場」一起存進紀錄的,
   * 不是畫面暫存 —— 關掉再打開同一場,已經結算過的直接顯示金額,不用重按一次。
   */
  renderSettle() {
    const d = this.draft;
    const calc = this.calc(d);
    const badge = document.getElementById('ss-net-badge');

    if (!this.isSettled(d)) {
      if (badge) { badge.className = 'sess-net pending'; badge.textContent = '未結算'; }
      document.getElementById('ss-settle').innerHTML = `
        <p class="hint">冷氣費和臨打球友的費用還沒結算。金額、已收 / 未收都填好、勾好之後,
        按下面按鈕才會算出這場賺賠多少。</p>
        <button class="btn primary block" id="ss-do-settle" type="button">${icon('wallet', '', 16)} 結算這場</button>`;
      const btn = document.getElementById('ss-do-settle');
      if (btn) btn.addEventListener('click', () => this.doSettle());
      return;
    }

    /* 用球明細:一種球一行,寫清楚幾顆 × 單價 = 多少錢 */
    const useLines = calc.use.map(u =>
      `${esc(Shuttles.nameOf(u.sid))} ${num(u.n)} 顆 × ${Shuttles.priceLabel(Shuttles.unitPriceOf(u.sid))}
       = ${money(num(u.n) * Shuttles.unitPriceOf(u.sid))}`).join('<br>');

    /* 標題旁邊的徽章跟著結算一起更新,不用滑到最下面才看得到淨額 */
    if (badge) {
      badge.className = `sess-net ${calc.net >= 0 ? 'in' : 'out'}`;
      badge.textContent = `${calc.net >= 0 ? '+' : ''}${money(calc.net)}`;
    }

    document.getElementById('ss-settle').innerHTML = `
      <div class="settle">
        <div class="settle-line"><span>臨打收入 ${calc.guestCount ? `(${d.guests.filter(g => g.paid).length} 人已收)` : ''}</span><span class="n in">+${money(calc.guestIncome)}</span></div>
        ${calc.guestUnpaid ? `<div class="settle-line"><span>臨打未收</span><span class="n out">${money(calc.guestUnpaid)}</span></div>` : ''}
        ${calc.courtFee ? `<div class="settle-line"><span>場地費(舊制)</span><span class="n out">-${money(calc.courtFee)}</span></div>` : ''}
        <div class="settle-line"><span>冷氣費</span><span class="n out">-${money(calc.acFee)}</span></div>
        <div class="settle-line total"><span>本場公款進出</span><span class="n ${calc.net >= 0 ? 'in' : 'out'}">${calc.net >= 0 ? '+' : ''}${money(calc.net)}</span></div>
        ${calc.shuttles ? `<div class="settle-line ref"><span>羽球耗用費用 <span class="hint" style="font-size:11px">(參考,已在買球時付款)</span></span><span class="n">${money(calc.shuttleCost)}</span></div>` : ''}
      </div>
      ${calc.shuttles ? `<p class="settle-note">${useLines}</p>` : ''}
      <p class="settle-note">出席 ${calc.head} 人。<br>
      本場實際成本 ${money(calc.cost)},平均每人 ${money(calc.perHead)}。</p>`;
  },

  doSettle() {
    this.readForm();          // 冷氣費打完沒離開欄位就直接按結算也要算到
    this.draft.settled = true;
    haptic();
    this.renderSettle();
  },

  /* 冷氣費 / 臨打費相關欄位一有變動就呼叫這個,把結算收回去、要求重按 */
  invalidateSettle() {
    this.draft.settled = false;
    this.renderSettle();
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
      Members.refreshBoth();
      Finance.render();
      Photos.render();
    }
  },
};
