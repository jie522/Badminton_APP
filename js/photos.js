/* 每週打球照片:壓縮後透過 Apps Script 存進自己的 Google Drive,只在 App 裡存檔案 id */
const Photos = {
  /* ---------- 相簿頁 ---------- */
  render() {
    const box = document.getElementById('photo-groups');
    const empty = document.getElementById('photo-empty');
    const groups = Sessions.list()
      .filter(s => (s.photos || []).length)
      .sort(byDateDesc);

    empty.classList.toggle('hidden', groups.length > 0);
    empty.querySelector('p').innerHTML = Sync.enabled()
      ? '還沒有照片<br>按右上角「＋」上傳這週的照片'
      : '還沒有照片<br>照片存在 Google Drive,請先到「設定」啟用同步';

    box.innerHTML = groups.map(s => `
      <div class="photo-group">
        <div class="photo-group-head">
          <div>${esc(shortDate(s.date))} ${esc(s.venue || '')}</div>
          <span>${(s.photos || []).length} 張</span>
        </div>
        <div class="photo-grid">
          ${s.photos.map(p => `<img src="${esc(Sync.photoUrl(p.id, 400))}" alt="${esc(p.caption || '')}"
            loading="lazy" data-sid="${esc(s.id)}" data-pid="${esc(p.id)}">`).join('')}
        </div>
      </div>`).join('');

    box.querySelectorAll('img').forEach(img =>
      img.addEventListener('click', () => this.openLightbox(img.dataset.sid, img.dataset.pid)));
  },

  /* ---------- 上傳 ---------- */
  /* 從相簿頁的「＋」進來:先問要傳到哪一場 */
  openAdd() {
    if (!this.guardSync()) return;
    const list = Sessions.list().sort(byDateDesc).slice(0, 20);
    if (!list.length) { toast('先到「場次」記一場球,才能上傳照片'); return; }
    Modal.open(`
      <button class="modal-close" data-close>✕</button>
      <h2>上傳照片</h2>
      <p class="hint">選一場要放照片的打球紀錄</p>
      <div class="card-list" style="margin-top:12px">
        ${list.map(s => `
          <button class="row-card" data-id="${esc(s.id)}">
            <div class="row-main">
              <div class="row-title" style="font-size:15px">${esc(shortDate(s.date))} ${esc(s.venue || '')}</div>
              <div class="row-sub">${(s.photos || []).length} 張照片</div>
            </div>
            <div class="row-right"><span class="chip">選這場</span></div>
          </button>`).join('')}
      </div>
    `);
    document.querySelectorAll('#modal .row-card').forEach(el =>
      el.addEventListener('click', () => {
        Modal.close();
        this.pickAndUpload(el.dataset.id, () => { this.render(); Sessions.render(); });
      }));
  },

  guardSync() {
    if (Sync.enabled()) return true;
    toast('照片存在 Google Drive,請先到「設定」啟用同步');
    return false;
  },

  pickAndUpload(sessionId, onDone) {
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
      if (files.length) await this.upload(sessionId, files);
      if (onDone) onDone();
    });
    input.click();
  },

  async upload(sessionId, files) {
    const session = Sessions.byId(sessionId);
    if (!session) { toast('找不到這場紀錄'); return; }
    Modal.open(`
      <h2>上傳照片中</h2>
      <p class="hint">照片會先縮到長邊 1600px 再上傳,省流量也省 Drive 空間。</p>
      <p class="progress" id="up-progress">準備中…</p>
      <div class="upload-preview" id="up-preview"></div>
    `);
    const prog = document.getElementById('up-progress');
    const preview = document.getElementById('up-preview');
    let done = 0, failed = 0;

    for (const file of files) {
      prog.textContent = `上傳中 ${done + failed + 1} / ${files.length}…`;
      try {
        const img = await compressImage(file);
        preview.insertAdjacentHTML('beforeend', `<img src="${img.dataUrl}" alt="">`);
        const id = await Sync.uploadPhoto({
          name: `${session.date}_${file.name.replace(/\.[^.]+$/, '')}.jpg`,
          mime: img.mime,
          b64: img.b64,
          sessionDate: session.date,
        });
        // 每張傳完就存一次,中途失敗前面已經傳好的不會白傳
        const list = Sessions.list();
        const s = list.find(x => x.id === sessionId);
        if (!s.photos) s.photos = [];
        s.photos.push({ id, caption: '', at: new Date().toISOString() });
        Sessions.saveList(list);
        done++;
      } catch (e) {
        failed++;
      }
    }

    Modal.close();
    Sessions.render();
    this.render();
    toast(failed ? `上傳完成 ${done} 張,失敗 ${failed} 張` : `已上傳 ${done} 張照片`);
  },

  /* ---------- 放大檢視 ---------- */
  openLightbox(sessionId, photoId) {
    const s = Sessions.byId(sessionId);
    if (!s) return;
    const photos = s.photos || [];
    let i = Math.max(0, photos.findIndex(p => p.id === photoId));
    const box = document.getElementById('lightbox');

    const draw = () => {
      const p = photos[i];
      if (!p) { close(); return; }
      box.innerHTML = `
        <img src="${esc(Sync.photoUrl(p.id, 1200))}" alt="">
        <div class="lb-cap">${esc(shortDate(s.date))} ${esc(s.venue || '')} · ${i + 1}/${photos.length}${p.caption ? '<br>' + esc(p.caption) : ''}</div>
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
        if (!confirm('刪除這張照片?(Drive 上的檔案會移到垃圾桶)')) return;
        const id = photos[i].id;
        const list = Sessions.list();
        const cur = list.find(x => x.id === sessionId);
        cur.photos = (cur.photos || []).filter(p => p.id !== id);
        Sessions.saveList(list);
        photos.splice(i, 1);
        if (i >= photos.length) i = photos.length - 1;
        Sync.deletePhoto(id);
        this.render();
        Sessions.render();
        if (!photos.length) close(); else draw();
        toast('已刪除照片');
      });
    };
    const close = () => { box.classList.add('hidden'); box.innerHTML = ''; };

    box.classList.remove('hidden');
    draw();
  },
};
