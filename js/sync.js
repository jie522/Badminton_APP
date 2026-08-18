/* Google Sheet / Drive 同步
 *
 * 全部走自己部署的 Google Apps Script(見 apps-script/Code.gs),讀寫都用同一個網址,
 * Sheet 不必公開。資料量小(一個球隊幾十人、一年上百場),所以哪張表有變動就整張覆寫,
 * 不做逐列 upsert —— 少很多同步錯位的 bug,代價是同一時間兩支手機改同一張表會後蓋前。
 */
const Sync = {
  url() { return (Store.load('settings', {}).scriptUrl || '').trim(); },
  enabled() { return !!this.url(); },

  /* 回傳完整 JSON;網址沒設定或連不上就丟錯 */
  async call(action, data) {
    const url = this.url();
    if (!url) throw new Error('NO_SCRIPT_URL');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避免 CORS preflight
      body: JSON.stringify({ action, data }),
    });
    return res.json();
  },

  async push(action, data) {
    if (!this.enabled()) return false;
    try {
      const json = await this.call(action, data);
      return !!json.ok;
    } catch {
      return false;
    }
  },

  /* 背景寫入:資料已經存進手機了,同步失敗只提醒一聲,不擋操作 */
  bg(table) {
    if (!this.enabled()) return;
    this.push('putTable', { table, rows: Store.load(table, []) }).then(ok => {
      if (!ok) toast('⚠️ 同步到 Google Sheet 失敗,資料先存在手機');
    });
  },

  /* 從 Sheet 拉回全部資料,覆蓋手機上的快取 */
  async pull() {
    const json = await this.call('pull', {});
    if (!json.ok) throw new Error(json.error || 'PULL_FAIL');
    Store.TABLES.forEach(t => {
      if (Array.isArray(json[t])) Store.save(t, json[t]);
    });
    setCfg({ lastSync: new Date().toISOString() });
    return json;
  },

  /* 把這支手機現有的資料整批上傳(啟用同步時的搬家) */
  async pushAll() {
    for (const t of Store.TABLES) {
      const ok = await this.push('putTable', { table: t, rows: Store.load(t, []) });
      if (!ok) return false;
    }
    return true;
  },

  /* ---------- 照片(Google Drive) ---------- */
  /* 上傳一張照片,回傳 Drive 檔案 id */
  async uploadPhoto({ name, mime, b64, sessionDate }) {
    const json = await this.call('uploadPhoto', { name, mime, b64, sessionDate });
    if (!json.ok) throw new Error(json.error || 'UPLOAD_FAIL');
    return json.id;
  },

  async deletePhoto(id) {
    return this.push('deletePhoto', { id });
  },

  /* Drive 檔案 id → 可直接放進 <img> 的網址 */
  photoUrl(id, w = 800) {
    return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`;
  },
};

/* ---------- 上傳前先壓縮,免得 base64 太大被 Apps Script 擋下來 ---------- */
function compressImage(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('READ_FAIL'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('DECODE_FAIL'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ b64: dataUrl.split(',')[1], mime: 'image/jpeg', dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
