/* 球員與季別:季打人員 / 臨打人員 / 季費繳納 */

const Seasons = {
  list() { return Store.load('seasons', []); },
  saveList(l) { Store.save('seasons', l); Sync.bg('seasons'); },
  byId(id) { return this.list().find(s => s.id === id) || null; },

  /* 目前這一季:先找日期落在區間內的,沒有就用最新開始的那一季 */
  current() {
    const list = this.list();
    if (!list.length) return null;
    const today = todayStr();
    const inRange = list.find(s => (s.start || '') <= today && today <= (s.end || '9999'));
    if (inRange) return inRange;
    return [...list].sort((a, b) => String(b.start).localeCompare(String(a.start)))[0];
  },

  payments() { return Store.load('payments', []); },
  savePayments(l) { Store.save('payments', l); Sync.bg('payments'); },

  /* 某人某季已繳金額 */
  paidOf(seasonId, memberId) {
    return this.payments()
      .filter(p => p.seasonId === seasonId && p.memberId === memberId)
      .reduce((s, p) => s + num(p.amount), 0);
  },

  /* 這一季的繳費總覽(每個人的季費可能不一樣,應收要一個一個加) */
  summary(season) {
    const members = Members.list().filter(m => m.type === 'season' && m.active !== false);
    let paidCount = 0, received = 0, expected = 0;
    members.forEach(m => {
      const fee = seasonFeeOf(m, season);
      const paid = this.paidOf(season.id, m.id);
      received += paid;
      expected += fee;
      /* 免繳(個人季費 0)的人算「收齊了」,不然進度永遠到不了 100% */
      if (fee <= 0 || paid >= fee) paidCount++;
    });
    return { total: members.length, paidCount, received, expected };
  },

  pay(seasonId, memberId, amount, date) {
    const amt = num(amount);
    /* $0 或負數不建立紀錄:免繳的人本來就不該有繳費紀錄,建了只會在收支頁多一筆
     * 看不出意義的「季費 $0」,下次真的收錢時又會疊一筆新的,看起來像分兩次繳。 */
    if (amt <= 0) return;
    const list = this.payments();
    list.push({ id: uid(), seasonId, memberId, amount: amt, date: date || todayStr(), note: '' });
    this.savePayments(list);
  },

  unpay(seasonId, memberId) {
    this.savePayments(this.payments().filter(p => !(p.seasonId === seasonId && p.memberId === memberId)));
  },

  /* ---------- 季別管理彈窗 ---------- */
  openManage() {
    const list = [...this.list()].sort((a, b) => String(b.start).localeCompare(String(a.start)));
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>季別管理</h2>
      <p class="hint">一季就是一個收費週期(例如「2026 秋季」)。季打球員繳一次固定季費,場地費由公款支付,每場不再收錢。</p>
      <div class="card-list" style="margin-top:12px">
        ${list.length ? list.map(s => `
          <button class="row-card" data-id="${esc(s.id)}">
            <div class="row-main">
              <div class="row-title">${esc(s.name)}</div>
              <div class="row-sub">${esc(s.start || '')} ~ ${esc(s.end || '')} · 季費 ${money(s.fee)}</div>
            </div>
            <div class="row-right"><span class="chip">編輯</span></div>
          </button>`).join('') : '<p class="hint">還沒有季別</p>'}
      </div>
      <button class="btn primary block" id="season-new">＋ 新增季別</button>
    `);
    document.getElementById('season-new').addEventListener('click', () => this.openEdit(null));
    document.querySelectorAll('#modal .row-card').forEach(el =>
      el.addEventListener('click', () => this.openEdit(el.dataset.id)));
  },

  openEdit(id) {
    const s = id ? this.byId(id) : null;
    const y = new Date().getFullYear();
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>${s ? '編輯季別' : '新增季別'}</h2>
      <label>季別名稱</label>
      <input type="text" id="se-name" value="${esc(s ? s.name : `${y} 秋季`)}" placeholder="例如:2026 秋季">
      <div class="field-row">
        <div><label>開始日期</label><input type="date" id="se-start" value="${esc(s ? s.start : todayStr())}"></div>
        <div><label>結束日期</label><input type="date" id="se-end" value="${esc(s ? s.end : '')}"></div>
      </div>
      <label>預設季費(元)</label>
      <input type="number" id="se-fee" inputmode="numeric" value="${s ? num(s.fee) : 3000}">
      <p class="hint" style="margin:-4px 0 4px">大部分人收這個金額。要單獨調某個人(學生半價、教練免繳),
      到那位球員的資料裡填「個人季費」,不用動這裡。</p>
      ${s ? `
        <h3>照片 <span class="hint">(${(s.photos || []).length} 張)</span></h3>
        <div class="photo-grid" id="se-photos">
          ${(s.photos || []).map(p => `<img src="${esc(Sync.photoUrl(p.id, 400))}" alt="" loading="lazy" data-pid="${esc(p.id)}">`).join('')}
        </div>
        <button class="btn block" id="se-upload" type="button">上傳這季的照片</button>` : ''}
      <button class="btn primary block" id="se-save">儲存</button>
      ${s ? '<button class="btn danger block" id="se-del">刪除這一季</button>' : ''}
    `);
    if (s) {
      document.getElementById('se-upload').addEventListener('click', () =>
        Photos.pickAndUpload('seasons', s.id, () => this.openEdit(s.id)));
      document.querySelectorAll('#se-photos img').forEach(img =>
        img.addEventListener('click', () => Photos.openLightbox('seasons', s.id, img.dataset.pid)));
    }
    document.getElementById('se-save').addEventListener('click', () => {
      const name = document.getElementById('se-name').value.trim();
      if (!name) { toast('請輸入季別名稱'); return; }
      const rec = {
        id: s ? s.id : uid(),
        name,
        start: document.getElementById('se-start').value,
        end: document.getElementById('se-end').value,
        fee: num(document.getElementById('se-fee').value),
        photos: s ? (s.photos || []) : [],   // 存檔是整包重建物件,照片要顯式帶過去才不會不見
      };
      const list = this.list();
      const i = list.findIndex(x => x.id === rec.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
      this.saveList(list);
      Modal.close();
      Members.renderSeasonPage();
      Sessions.render();
      Finance.render();
      toast('已儲存');
    });
    const del = document.getElementById('se-del');
    if (del) del.addEventListener('click', async () => {
      if (!await ask(`確定刪除「${s.name}」?\n這一季的繳費紀錄也會一起刪除。`)) return;
      this.saveList(this.list().filter(x => x.id !== s.id));
      this.savePayments(this.payments().filter(p => p.seasonId !== s.id));
      Modal.close();
      Members.renderSeasonPage();
      Finance.render();
      toast('已刪除');
    });
  },
};

const Members = {
  TYPE: { season: '季打', guest: '臨打' },
  seasonQ: '',        // 季打頁搜尋框的字
  guestQ: '',         // 人員(臨打)頁搜尋框的字

  list() { return Store.load('members', []); },
  saveList(l) { Store.save('members', l); Sync.bg('members'); },
  byId(id) { return this.list().find(m => m.id === id) || null; },
  name(id) { const m = this.byId(id); return m ? m.name : '(已刪除)'; },
  active(type) { return this.list().filter(m => m.active !== false && (!type || m.type === type)); },

  /* 臨打現場報到時直接打名字:名字已存在就沿用(性別以球員資料為準),不存在就自動建一位臨打球員 */
  ensureGuest(name, gender) {
    name = String(name || '').trim();
    if (!name) return null;
    const found = this.list().find(m => m.name === name);
    if (found) return found;
    const m = { id: uid(), name, type: 'guest', gender: gender === 'F' ? 'F' : 'M',
                phone: '', note: '', active: true, createdAt: new Date().toISOString() };
    const list = this.list();
    list.push(m);
    this.saveList(list);
    return m;
  },

  /* 出席場次數(全部場次,含臨打身分) */
  attendCount(memberId) {
    return Sessions.list().filter(s =>
      (s.attendees || []).includes(memberId) ||
      (s.guests || []).some(g => g.mid === memberId)).length;
  },

  /* 這位季打球員這一季還欠多少季費(排序和標記共用) */
  owes(m, season) {
    if (!season || m.type !== 'season' || m.active === false) return 0;
    const fee = seasonFeeOf(m, season);
    if (fee <= 0) return 0;
    return Math.max(0, fee - Seasons.paidOf(season.id, m.id));
  },

  /* ---------- 畫面 ----------
   * 季打、臨打各自獨立一頁(不再共用一份帶篩選器的列表),兩頁共用同一顆卡片模板(rowCardHtml),
   * 只是各自的資料來源、搜尋字、排序方式不一樣。改到球員資料的地方(存檔/刪除/大頭貼/收季費)
   * 統一呼叫 refreshBoth(),不用猜這個人現在該顯示在哪一頁。
   */
  matchesQuery(m, q) {
    return m.name.toLowerCase().includes(q) ||
      String(m.phone || '').toLowerCase().includes(q) ||
      String(m.note || '').toLowerCase().includes(q);
  },

  rowCardHtml(m, season) {
    const cnt = this.attendCount(m.id);
    const fee = (m.type === 'season' && season) ? seasonFeeOf(m, season) : 0;
    let payChip = '';
    if (m.type === 'season' && season && hasOwnSeasonFee(m) && fee <= 0) {
      payChip = '<span class="chip">季費免繳</span>';
    } else if (m.type === 'season' && fee > 0) {
      const paid = Seasons.paidOf(season.id, m.id);
      payChip = paid >= fee
        ? '<span class="chip paid">季費已繳</span>'
        : paid > 0
          ? `<span class="chip unpaid">尚欠 ${money(fee - paid)}</span>`
          : '<span class="chip unpaid">季費未繳</span>';
    }
    /* 已經在對的頁面了(季打頁只有季打、人員頁只有臨打),不用再標一次類型;
     * 有沒有繳錢才是要一眼看到的重點,單獨放右邊、保留紅/綠/中性的顏色語意。 */
    return `<button class="row-card" data-id="${esc(m.id)}">
        ${avatarHtml(m.name, m.active === false ? 'dim' : '', m.avatarId)}
        <div class="row-main">
          <div class="row-title">${esc(m.name)}
            ${m.active === false ? '<span class="chip off">停打</span>' : ''}
          </div>
          <div class="row-sub">${GENDER[genderOf(m)]}${m.type === 'guest' ? ` · 單場 ${money(guestFeeOf(m))}` : ''}${m.type === 'season' && hasOwnSeasonFee(m) ? ` · 個人季費 ${money(m.seasonFee)}` : ''} · 出席 ${cnt} 場${m.phone ? ' · ' + esc(m.phone) : ''}${m.note ? ' · ' + esc(m.note) : ''}</div>
        </div>
        ${payChip ? `<div class="row-right">${payChip}</div>` : ''}
      </button>`;
  },

  /* ---------- 季打頁 ---------- */
  renderSeasonPage() {
    this.renderSeasonCard();
    const box = document.getElementById('season-member-list');
    const empty = document.getElementById('season-member-empty');
    const all = this.list().filter(m => m.type === 'season');
    const season = Seasons.current();
    const q = this.seasonQ.trim().toLowerCase();

    let list = q ? all.filter(m => this.matchesQuery(m, q)) : all;
    /* 還沒繳季費的排最前面(欠越多越前面),其餘照名字排 */
    list = [...list].sort((a, b) => {
      const d = this.owes(b, season) - this.owes(a, season);
      if (d) return d;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });

    empty.classList.toggle('hidden', list.length > 0);
    empty.querySelector('p').innerHTML = q
      ? `找不到符合「${esc(this.seasonQ.trim())}」的球員`
      : '還沒有季打球員<br>按右下角「＋」新增';

    box.innerHTML = list.map(m => this.rowCardHtml(m, season)).join('');
    box.querySelectorAll('.row-card').forEach(el =>
      el.addEventListener('click', () => this.openDetail(el.dataset.id)));
  },

  /* ---------- 人員頁(臨打) ---------- */
  renderGuestPage() {
    const box = document.getElementById('member-list');
    const empty = document.getElementById('member-empty');
    const all = this.list().filter(m => m.type === 'guest');
    const q = this.guestQ.trim().toLowerCase();

    let list = q ? all.filter(m => this.matchesQuery(m, q)) : all;
    list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

    empty.classList.toggle('hidden', list.length > 0);
    empty.querySelector('p').innerHTML = q
      ? `找不到符合「${esc(this.guestQ.trim())}」的球友`
      : '還沒有臨打球友<br>按右下角「＋」新增';

    box.innerHTML = list.map(m => this.rowCardHtml(m, null)).join('');
    box.querySelectorAll('.row-card').forEach(el =>
      el.addEventListener('click', () => this.openDetail(el.dataset.id)));
  },

  refreshBoth() {
    this.renderSeasonPage();
    this.renderGuestPage();
  },

  renderSeasonCard() {
    const box = document.getElementById('season-card');
    const season = Seasons.current();
    if (!season) {
      box.innerHTML = `
        <div class="season-head">
          <div><div class="season-name">還沒有設定季別</div>
          <div class="season-range">建立一季之後才能記錄季費繳納</div></div>
          <button class="btn small primary" id="season-manage">建立</button>
        </div>`;
    } else {
      const s = Seasons.summary(season);
      const pct = s.total ? Math.round(s.paidCount / s.total * 100) : 0;
      const custom = this.active('season').filter(m => hasOwnSeasonFee(m)).length;
      box.innerHTML = `
        <div class="season-head">
          <div>
            <div class="season-name">${esc(season.name)}</div>
            <div class="season-range">${esc(season.start || '')} ~ ${esc(season.end || '')} · 預設季費 ${money(season.fee)}${custom ? ` · ${custom} 人個別設定` : ''}</div>
          </div>
          <button class="btn small" id="season-manage">季別</button>
        </div>
        <div class="season-bar"><i style="width:${pct}%"></i></div>
        <div class="season-pay">季費已繳 <b>${s.paidCount}/${s.total}</b> 人 · 已收 <b>${money(s.received)}</b>
          ${s.expected > s.received ? ` · 待收 <b>${money(s.expected - s.received)}</b>` : ''}</div>
        <button class="link-btn" id="season-collect">收季費 →</button>`;
    }
    const manage = document.getElementById('season-manage');
    if (manage) manage.addEventListener('click', () => Seasons.openManage());
    const collect = document.getElementById('season-collect');
    if (collect) collect.addEventListener('click', () => this.openCollect());
  },

  /* 一次勾選誰繳了季費 */
  openCollect() {
    const season = Seasons.current();
    if (!season) return;
    const members = this.active('season').sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    /* 只要有人有金額就能收(有人設個人季費、季別預設是 0 也算數) */
    if (!members.some(m => seasonFeeOf(m, season) > 0)) {
      toast('這一季還沒有人有季費金額,先設定季別的預設季費');
      Seasons.openEdit(season.id);
      return;
    }
    Modal.open(`
      <button class="modal-close" data-close aria-label="關閉">✕</button>
      <h2>收季費 · ${esc(season.name)}</h2>
      <p class="hint">點一下切換「已繳 / 未繳」。已繳的會自動記進公款收入,金額用每個人自己的季費
      (預設 ${money(season.fee)},要單獨調某個人就到他的球員資料改「個人季費」)。</p>
      <div id="collect-list" style="margin-top:12px"></div>
    `);
    const render = () => {
      const box = document.getElementById('collect-list');
      box.innerHTML = members.map(m => {
        const fee = seasonFeeOf(m, season);
        const paid = Seasons.paidOf(season.id, m.id);
        const done = fee > 0 && paid >= fee;
        /* 免繳的人不給按:按了會產生一筆 $0 的繳費紀錄,帳目上會多出沒意義的列 */
        return `<div class="guest-row">
          <span class="g-name">${avatarHtml(m.name, 'sm', m.avatarId)}<span class="g-nm">${esc(m.name)}</span>
            ${hasOwnSeasonFee(m) ? '<span class="chip">個人價</span>' : ''}</span>
          <span class="hint num">${paid ? money(paid) + ' / ' : ''}${money(fee)}</span>
          ${fee > 0
            ? `<button class="g-paid ${done ? 'on' : ''}" type="button" data-id="${esc(m.id)}">${done ? '✓ 已繳' : '未繳'}</button>`
            : '<span class="chip">免繳</span>'}
        </div>`;
      }).join('') || '<p class="hint">還沒有季打球員</p>';
      box.querySelectorAll('.g-paid').forEach(btn =>
        btn.addEventListener('click', () => {
          const id = btn.dataset.id;
          const fee = seasonFeeOf(this.byId(id), season);
          if (fee > 0 && Seasons.paidOf(season.id, id) >= fee) Seasons.unpay(season.id, id);
          else Seasons.pay(season.id, id, fee - Seasons.paidOf(season.id, id));
          haptic();
          render();
          this.renderSeasonPage();
          Finance.render();
        }));
    };
    render();
  },

  /* ---------- 新增 / 編輯 ---------- */
  openAdd(type) { this.openEdit(null, type); },

  openEdit(id, defaultType) {
    const m = id ? this.byId(id) : null;
    const type = m ? m.type : (defaultType === 'guest' ? 'guest' : 'season');
    const season = Seasons.current();
    Modal.open(`
      <button class="modal-close" data-close aria-label="關閉">✕</button>
      <h2>${m ? '編輯球員' : '新增球員'}</h2>
      ${m ? `
        <button type="button" class="avatar-pick" id="mb-avatar-btn" aria-label="更換大頭貼">
          ${avatarHtml(m.name, 'lg', m.avatarId)}
          <span class="avatar-pick-badge">${icon('camera', '', 14)}</span>
        </button>
        ${m.avatarId ? '<button type="button" class="link-btn" id="mb-avatar-remove" style="display:block;margin:2px auto 4px">移除大頭貼</button>' : ''}
      ` : ''}
      <label>姓名 / 綽號</label>
      <input type="text" id="mb-name" value="${esc(m ? m.name : '')}" placeholder="例如:阿翔">
      <label>類型</label>
      <div class="type-picker" id="mb-type">
        <button data-type="season" class="${type === 'season' ? 'active' : ''}">季打</button>
        <button data-type="guest" class="${type === 'guest' ? 'active' : ''}">臨打</button>
      </div>
      <label>性別(決定臨打單場費:男 ${money(cfg().guestFeeM)} / 女 ${money(cfg().guestFeeF)})</label>
      <div class="type-picker" id="mb-gender">
        <button data-gender="M" class="${genderOf(m) === 'M' ? 'active' : ''}">男</button>
        <button data-gender="F" class="${genderOf(m) === 'F' ? 'active' : ''}">女</button>
      </div>
      <label>個人季費(選填,只有季打會用到)</label>
      <input type="number" id="mb-fee" inputmode="numeric" value="${m && hasOwnSeasonFee(m) ? num(m.seasonFee) : ''}"
             placeholder="留白 = 用季別預設 ${season ? money(season.fee) : '季費'}">
      <p class="hint" style="margin:-4px 0 4px">學生半價填 1500、教練免繳填 0,這種個別狀況填在這裡,
      不影響其他人,也不用改季別的預設季費。留白就是跟大家一樣。</p>
      <label>電話 / LINE(選填)</label>
      <input type="text" id="mb-phone" value="${esc(m ? m.phone : '')}" placeholder="0912-345-678">
      <label>備註(選填)</label>
      <input type="text" id="mb-note" value="${esc(m ? m.note : '')}" placeholder="例如:雙打右半場、程度中上">
      ${m ? `<label>狀態</label>
      <div class="type-picker" id="mb-active">
        <button data-active="1" class="${m.active !== false ? 'active' : ''}">在打</button>
        <button data-active="0" class="${m.active === false ? 'active' : ''}">停打</button>
      </div>` : ''}
      <button class="btn primary block" id="mb-save">儲存</button>
      ${m ? '<button class="btn danger block" id="mb-del">刪除球員</button>' : ''}
    `);
    if (m) {
      document.getElementById('mb-avatar-btn').addEventListener('click', () =>
        this.pickAvatar(m.id, () => this.openEdit(m.id)));
      const rm = document.getElementById('mb-avatar-remove');
      if (rm) rm.addEventListener('click', async () => {
        if (!await ask('移除大頭貼?')) return;
        this.removeAvatar(m.id);
        this.openEdit(m.id);
      });
    }

    /* 三組單選(類型 / 性別 / 狀態)行為一樣,一起綁 */
    document.querySelectorAll('#modal .type-picker').forEach(group =>
      group.querySelectorAll('button').forEach(b =>
        b.addEventListener('click', () => {
          group.querySelectorAll('button').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
        })));

    document.getElementById('mb-save').addEventListener('click', () => {
      const name = document.getElementById('mb-name').value.trim();
      if (!name) { toast('請輸入姓名'); return; }
      const activeBtn = document.querySelector('#mb-active button.active');
      const rec = {
        id: m ? m.id : uid(),
        name,
        type: document.querySelector('#mb-type button.active').dataset.type,
        gender: document.querySelector('#mb-gender button.active').dataset.gender,
        phone: document.getElementById('mb-phone').value.trim(),
        note: document.getElementById('mb-note').value.trim(),
        /* 留白要存成空字串(跟預設走),不能存 0 —— 0 代表這個人免繳 */
        seasonFee: document.getElementById('mb-fee').value.trim() === ''
          ? '' : num(document.getElementById('mb-fee').value),
        active: activeBtn ? activeBtn.dataset.active === '1' : true,
        createdAt: m ? m.createdAt : new Date().toISOString(),
        avatarId: m ? (m.avatarId || '') : '',   // 存檔是整包重建物件,大頭貼要顯式帶過去才不會不見
      };
      const list = this.list();
      const i = list.findIndex(x => x.id === rec.id);
      if (i >= 0) list[i] = rec; else list.push(rec);
      this.saveList(list);
      Modal.close();
      this.refreshBoth();
      /* 類型可能被改了(季打⇄臨打),切到那個人現在真正所在的頁面,
       * 不然使用者會困惑剛存的人怎麼不在眼前這個列表上。 */
      switchPage(rec.type === 'guest' ? 'members' : 'season');
      toast('已儲存');
    });

    const del = document.getElementById('mb-del');
    if (del) del.addEventListener('click', async () => {
      const cnt = this.attendCount(m.id);
      if (!await ask(`確定刪除「${m.name}」?${cnt ? `\n他有 ${cnt} 場出席紀錄,刪除後那些場次會顯示「已刪除」。` : ''}`)) return;
      this.saveList(this.list().filter(x => x.id !== m.id));
      Seasons.savePayments(Seasons.payments().filter(p => p.memberId !== m.id));
      Modal.close();
      this.refreshBoth();
      Finance.render();
      toast('已刪除');
    });
  },

  /* ---------- 大頭貼 ----------
   * 只存一張(不像場次/季別/收支的 photos 是相簿陣列),換照片就覆蓋,
   * 舊檔案丟到 Drive 垃圾桶,不留孤兒檔案佔空間。
   */
  pickAvatar(id, onDone) {
    if (!Sync.enabled()) { toast('大頭貼存在 Google Drive,請先到「設定」啟用同步'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (file) await this.uploadAvatar(id, file);
      if (onDone) onDone();
    });
    input.click();
  },

  async uploadAvatar(id, file) {
    const m = this.byId(id);
    if (!m) return;
    const oldId = m.avatarId;
    try {
      const img = await compressImage(file, 480, 0.85);   // 大頭貼不用像相簿照片那麼大張
      const newId = await Sync.uploadPhoto({
        name: `avatar_${id}.jpg`, mime: img.mime, b64: img.b64, sessionDate: 'avatar',
      });
      const list = this.list();
      const rec = list.find(x => x.id === id);
      rec.avatarId = newId;
      this.saveList(list);
      if (oldId) Sync.deletePhoto(oldId);
      this.refreshBoth();
      toast('大頭貼已更新');
    } catch (e) {
      toast('上傳失敗,請再試一次');
    }
  },

  removeAvatar(id) {
    const list = this.list();
    const rec = list.find(x => x.id === id);
    if (!rec || !rec.avatarId) return;
    const oldId = rec.avatarId;
    rec.avatarId = '';
    this.saveList(list);
    Sync.deletePhoto(oldId);
    this.refreshBoth();
    toast('已移除大頭貼');
  },

  /* ---------- 球員詳情 ---------- */
  openDetail(id) {
    const m = this.byId(id);
    if (!m) return;
    const season = Seasons.current();
    const sessions = Sessions.list()
      .filter(s => (s.attendees || []).includes(m.id) || (s.guests || []).some(g => g.mid === m.id))
      .sort(byDateDesc);
    const seasonSessions = season
      ? sessions.filter(s => s.date >= (season.start || '') && s.date <= (season.end || '9999'))
      : [];

    let payBlock = '';
    if (m.type === 'season' && season && hasOwnSeasonFee(m) && seasonFeeOf(m, season) <= 0) {
      payBlock = `<h3>${esc(season.name)} 季費</h3>
        <p class="hint">這一季設定為<b>免繳</b>(個人季費 0)。要改回一般金額,到「編輯球員資料」把個人季費清空。</p>`;
    } else if (m.type === 'season' && season && seasonFeeOf(m, season) > 0) {
      const paid = Seasons.paidOf(season.id, m.id);
      const fee = seasonFeeOf(m, season);
      const done = paid >= fee;
      payBlock = `
        <h3>${esc(season.name)} 季費</h3>
        <div class="settle">
          <div class="settle-line"><span>季費${hasOwnSeasonFee(m) ? '(個人價)' : ''}</span><span class="n">${money(fee)}</span></div>
          <div class="settle-line"><span>已繳</span><span class="n in">${money(paid)}</span></div>
          ${done ? '' : `<div class="settle-line total"><span>尚欠</span><span class="n out">${money(fee - paid)}</span></div>`}
        </div>
        <button class="btn ${done ? '' : 'primary'} block" id="md-pay">${done ? '↩ 取消已繳註記' : '✓ 標記季費已繳'}</button>`;
    } else if (m.type === 'guest') {
      const unpaid = sessions.reduce((sum, s) => {
        const g = (s.guests || []).find(g => g.mid === m.id);
        return sum + (g && !g.paid ? num(g.fee) : 0);
      }, 0);
      payBlock = `
        <h3>臨打費用</h3>
        <div class="settle">
          <div class="settle-line"><span>單場費(${GENDER[genderOf(m)]})</span><span class="n">${money(guestFeeOf(m))}</span></div>
          <div class="settle-line"><span>已收</span><span class="n in">${money(sessions.reduce((sum, s) => {
            const g = (s.guests || []).find(g => g.mid === m.id);
            return sum + (g && g.paid ? num(g.fee) : 0);
          }, 0))}</span></div>
          ${unpaid ? `<div class="settle-line total"><span>未收</span><span class="n out">${money(unpaid)}</span></div>` : ''}
        </div>`;
    }

    Modal.open(`
      <button class="modal-close" data-close aria-label="關閉">✕</button>
      <div style="display:flex;align-items:center;gap:14px">
        ${avatarHtml(m.name, 'lg', m.avatarId)}
        <div style="min-width:0">
          <h2 style="margin-bottom:6px">${esc(m.name)}</h2>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span class="chip ${m.type === 'guest' ? 'guest' : ''}">${this.TYPE[m.type]}</span>
            <span class="chip off">${GENDER[genderOf(m)]}</span>
            ${m.active === false ? '<span class="chip off">停打</span>' : ''}
          </div>
        </div>
      </div>
      <div class="hint" style="margin-top:10px">${m.phone ? '📞 ' + esc(m.phone) + '<br>' : ''}${m.note ? esc(m.note) : ''}</div>
      <div class="stat-grid" style="margin-top:14px">
        <div class="stat"><div class="k">總出席</div><div class="v">${sessions.length}</div></div>
        <div class="stat"><div class="k">本季出席</div><div class="v">${season ? seasonSessions.length : '—'}</div></div>
        <div class="stat"><div class="k">最近一次</div><div class="v" style="font-size:14px">${sessions[0] ? shortDate(sessions[0].date) : '—'}</div></div>
      </div>
      ${payBlock}
      <h3>出席紀錄</h3>
      <div class="card-list">
        ${sessions.slice(0, 12).map(s => `
          <div class="row-card">
            <div class="row-main">
              <div class="row-title" style="font-size:14px">${esc(shortDate(s.date))} ${esc(s.venue || '')}</div>
              <div class="row-sub">${(s.attendees || []).includes(m.id) ? '季打出席'
                : (() => { const g = (s.guests || []).find(g => g.mid === m.id);
                    return `臨打 ${money(g.fee)}${g.paid ? ' · 已付' : ' · 未付'}`; })()}</div>
            </div>
          </div>`).join('') || '<p class="hint">還沒有出席紀錄</p>'}
      </div>
      <button class="btn block" id="md-edit">編輯球員資料</button>
    `);
    document.getElementById('md-edit').addEventListener('click', () => this.openEdit(m.id));
    const pay = document.getElementById('md-pay');
    if (pay) pay.addEventListener('click', () => {
      const fee = seasonFeeOf(m, season);
      const paid = Seasons.paidOf(season.id, m.id);
      if (fee > 0 && paid >= fee) Seasons.unpay(season.id, m.id);
      else Seasons.pay(season.id, m.id, fee - paid);
      Modal.close();
      this.renderSeasonPage();
      Finance.render();
      toast('已更新季費狀態');
    });
  },
};
