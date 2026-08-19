/* 照片:壓縮後透過 Apps Script 存進自己的 Google Drive,只在 App 裡存檔案 id
 *
 * 場次、季別、收支都能放照片(球員報到單、季初合照、買球收據、贊助收據這類)。
 * OWNERS 是這三種資料表的存取方式對照表,其餘的上傳 / 顯示 / 刪除邏輯共用一份,
 * 加新的「可以放照片的地方」只要在這裡多加一筆設定。
 */
const Photos = {
  OWNERS: {
    sessions: {
      label: '場次',
      list: () => Sessions.list(),
      save: l => Sessions.saveList(l),
      caption: s => [shortDate(s.date), s.venue].filter(Boolean).join(' ') || '打球',
      sortKey: s => s.date,
      afterChange: () => Sessions.render(),
    },
    seasons: {
      label: '季別',
      list: () => Seasons.list(),
      save: l => Seasons.saveList(l),
      caption: s => s.name || '季別',
      sortKey: s => s.start,
      afterChange: () => Members.render(),
    },
    txns: {
      label: '收支',
      list: () => Finance.txns(),
      save: l => Finance.saveTxns(l),
      caption: t => [t.cat, t.note].filter(Boolean).join(' · ') || '收支',
      sortKey: t => t.date,
      afterChange: () => Finance.render(),
    },
  },

  find(table, id) {
    const o = this.OWNERS[table];
    return o ? (o.list().find(x => x.id === id) || null) : null;
  },

  /* ---------- 相簿頁:三種來源混在一起,按日期新到舊排 ---------- */
  render() {
    const box = document.getElementById('photo-groups');
    const empty = document.getElementById('photo-empty');
    const groups = [];
    Object.keys(this.OWNERS).forEach(table => {
      const o = this.OWNERS[table];
      o.list().filter(x => (x.photos || []).length)
        .forEach(item => groups.push({ table, item, date: o.sortKey(item) || '' }));
    });
    groups.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    empty.classList.toggle('hidden', groups.length > 0);
    empty.querySelector('p').innerHTML = Sync.enabled()
      ? '還沒有照片<br>按右下角「＋」上傳照片'
      : '還沒有照片<br>照片存在 Google Drive,請先到「設定」啟用同步';

    box.innerHTML = groups.map(g => {
      const o = this.OWNERS[g.table];
      return `<div class="photo-group">
        <div class="photo-group-head">
          <div>${esc(o.caption(g.item))} <span class="chip off">${o.label}</span></div>
          <span>${g.item.photos.length} 張</span>
        </div>
        <div class="photo-grid">
          ${g.item.photos.map(p => `<img src="${esc(Sync.photoUrl(p.id, 400))}" alt="${esc(p.caption || '')}"
            loading="lazy" data-table="${g.table}" data-id="${esc(g.item.id)}" data-pid="${esc(p.id)}">`).join('')}
        </div>
      </div>`;
    }).join('');

    box.querySelectorAll('img').forEach(img =>
      img.addEventListener('click', () => this.openLightbox(img.dataset.table, img.dataset.id, img.dataset.pid)));
  },

  /* ---------- 上傳 ---------- */
  /* 從相簿頁的「＋」進來:先選類別,再選要放照片的那一筆 */
  openAdd() {
    if (!this.guardSync()) return;
    Modal.open(`
      <button class="modal-close" data-close aria-label="關閉">✕</button>
      <h2>上傳照片</h2>
      <p class="hint">先選類別,再選要放照片的那一筆。</p>
      <div class="type-picker" id="ph-kind">
        ${Object.keys(this.OWNERS).map((t, i) => `<button data-table="${t}" class="${i === 0 ? 'active' : ''}">${this.OWNERS[t].label}</button>`).join('')}
      </div>
      <div id="ph-list" style="margin-top:14px"></div>
    `);
    const renderList = table => {
      const o = this.OWNERS[table];
      const list = [...o.list()]
        .sort((a, b) => String(o.sortKey(b) || '').localeCompare(String(o.sortKey(a) || '')))
        .slice(0, 30);
      document.getElementById('ph-list').innerHTML = list.length
        ? `<div class="card-list">${list.map(x => `
            <button class="row-card" data-id="${esc(x.id)}">
              <div class="row-main">
                <div class="row-title" style="font-size:15px">${esc(o.caption(x))}</div>
                <div class="row-sub">${(x.photos || []).length} 張照片</div>
              </div>
              <div class="row-right"><span class="chip">選這筆</span></div>
            </button>`).join('')}</div>`
        : `<p class="hint">還沒有${o.label}紀錄,先去記一筆</p>`;
      document.querySelectorAll('#ph-list .row-card').forEach(el =>
        el.addEventListener('click', () => {
          Modal.close();
          this.pickAndUpload(table, el.dataset.id, () => { this.render(); o.afterChange(); });
        }));
    };
    document.querySelectorAll('#ph-kind button').forEach(btn =>
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ph-kind button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderList(btn.dataset.table);
      }));
    renderList(Object.keys(this.OWNERS)[0]);
  },

  guardSync() {
    if (Sync.enabled()) return true;
    toast('照片存在 Google Drive,請先到「設定」啟用同步');
    return false;
  },

  pickAndUpload(table, id, onDone) {
    if (!this.guardSync()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const files = [...input.files];
      input.remove();
      if (files.length) await this.upload(table, id, files);
      if (onDone) onDone();
    });
    input.click();
  },

  async upload(table, id, files) {
    const o = this.OWNERS[table];
    const item = this.find(table, id);
    if (!item) { toast('找不到這筆紀錄'); return; }
    Modal.open(`
      <h2>上傳照片中</h2>
      <p class="hint">照片會先縮到長邊 1600px 再上傳,省流量也省 Drive 空間。</p>
      <p class="progress" id="up-progress">準備中…</p>
      <div class="upload-preview" id="up-preview"></div>
    `);
    const prog = document.getElementById('up-progress');
    const preview = document.getElementById('up-preview');
    let done = 0, failed = 0;
    const dateHint = o.sortKey(item) || todayStr();

    for (const file of files) {
      prog.textContent = `上傳中 ${done + failed + 1} / ${files.length}…`;
      try {
        const img = await compressImage(file);
        preview.insertAdjacentHTML('beforeend', `<img src="${img.dataUrl}" alt="">`);
        const pid = await Sync.uploadPhoto({
          name: `${dateHint}_${file.name.replace(/\.[^.]+$/, '')}.jpg`,
          mime: img.mime,
          b64: img.b64,
          sessionDate: dateHint,
        });
        // 每張傳完就存一次,中途失敗前面已經傳好的不會白傳
        const list = o.list();
        const rec = list.find(x => x.id === id);
        if (!rec.photos) rec.photos = [];
        rec.photos.push({ id: pid, caption: '', at: new Date().toISOString() });
        o.save(list);
        done++;
      } catch (e) {
        failed++;
      }
    }

    Modal.close();
    o.afterChange();
    this.render();
    toast(failed ? `上傳完成 ${done} 張,失敗 ${failed} 張` : `已上傳 ${done} 張照片`);
  },

  /* ---------- 放大檢視 ---------- */
  openLightbox(table, id, photoId) {
    const o = this.OWNERS[table];
    const item = this.find(table, id);
    if (!item) return;
    const photos = item.photos || [];
    let i = Math.max(0, photos.findIndex(p => p.id === photoId));
    const box = document.getElementById('lightbox');

    const draw = () => {
      const p = photos[i];
      if (!p) { close(); return; }
      box.innerHTML = `
        <img src="${esc(Sync.photoUrl(p.id, 1200))}" alt="">
        <div class="lb-cap">${esc(o.caption(item))} · ${i + 1}/${photos.length}${p.caption ? '<br>' + esc(p.caption) : ''}</div>
        <div class="lb-bar">
          <button class="btn small" id="lb-prev" ${i === 0 ? 'disabled' : ''}>‹ 上一張</button>
          <button class="btn small" id="lb-next" ${i >= photos.length - 1 ? 'disabled' : ''}>下一張 ›</button>
          <button class="btn small danger" id="lb-del">刪除</button>
          <button class="btn small" id="lb-close">關閉</button>
        </div>`;
      document.getElementById('lb-prev').addEventListener('click', () => { i--; draw(); });
      document.getElementById('lb-next').addEventListener('click', () => { i++; draw(); });
      document.getElementById('lb-close').addEventListener('click', close);
      document.getElementById('lb-del').addEventListener('click', async () => {
        if (!await ask('刪除這張照片?\n(Drive 上的檔案會移到垃圾桶)')) return;
        const pid = photos[i].id;
        const list = o.list();
        const cur = list.find(x => x.id === id);
        cur.photos = (cur.photos || []).filter(p => p.id !== pid);
        o.save(list);
        photos.splice(i, 1);
        if (i >= photos.length) i = photos.length - 1;
        Sync.deletePhoto(pid);
        this.render();
        o.afterChange();
        if (!photos.length) close(); else draw();
        toast('已刪除照片');
      });
    };
    const close = () => { box.classList.add('hidden'); box.innerHTML = ''; };

    box.classList.remove('hidden');
    draw();
  },
};
