// 集めたデータの置き場(IndexedDB)と、Lステップの画面・beyond line の画面の間の受け渡し。
// データは、この拡張機能の中にだけ保存される(外部には送らない)。beyond line の画面が「取り込む」ときに読み出し、
// 取り込みが終わったら画面から削除する。
const DB_NAME = 'beyond-line-lstep';
const STORE = 'parts';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: ['pkg', 'key'] });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

async function putMany(pkg, items) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  for (const [key, value] of items) tx.objectStore(STORE).put({ pkg, key, value });
  await done(tx);
}
async function getAll(pkg) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = [];
    const range = IDBKeyRange.bound([pkg, ''], [pkg, '￿']);
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor(range);
    req.onsuccess = () => { const c = req.result; if (c) { out.push(c.value); c.continue(); } else resolve(out); };
    req.onerror = () => reject(req.error);
  });
}
async function removePkg(pkg) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(IDBKeyRange.bound([pkg, ''], [pkg, '￿']));
  await done(tx);
}
async function listPackages() {
  const db = await openDb();
  const metas = await new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { if (c.value.key === 'meta') out.push({ id: c.value.pkg, ...c.value.value }); c.continue(); } else resolve(out); };
    req.onerror = () => reject(req.error);
  });
  return metas.sort((a, b) => (a.collectedAt < b.collectedAt ? 1 : -1));
}
/** 保存した部品を、PACKAGE_FORMAT.md の LstepPackage の形に組み立てる */
async function assemble(pkg) {
  const rows = await getAll(pkg);
  const out = { version: 1, list: {}, members: {}, csvRows: [], fieldDefs: [], tagDefs: [], forms: [], messages: {}, warnings: [] };
  for (const { key, value } of rows) {
    if (key === 'meta') Object.assign(out, { collectedAt: value.collectedAt, lstepHost: value.lstepHost, accountName: value.accountName });
    else if (key === 'list') out.list = value;
    else if (key === 'csvRows') out.csvRows = value;
    else if (key === 'fieldDefs') out.fieldDefs = value;
    else if (key === 'tagDefs') out.tagDefs = value;
    else if (key === 'warnings') out.warnings = value;
    else if (key.startsWith('member:')) out.members[key.slice(7)] = value;
    else if (key.startsWith('messages:')) out.messages[key.slice(9)] = value;
    else if (key.startsWith('form:')) out.forms.push(value);
  }
  out.forms.sort((a, b) => Number(a.lid) - Number(b.lid));
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'put': await putMany(msg.pkg, msg.items); return { ok: true };
      case 'list': return { ok: true, packages: await listPackages() };
      case 'get': return { ok: true, data: await assemble(msg.pkg) };
      case 'delete': await removePkg(msg.pkg); return { ok: true };
      case 'keys': {
        const rows = await getAll(msg.pkg);
        return { ok: true, keys: rows.map((r) => r.key).filter((k) => k.startsWith(msg.prefix || '')) };
      }
      case 'counts': {
        const rows = await getAll(msg.pkg);
        const n = (p) => rows.filter((r) => r.key.startsWith(p)).length;
        return { ok: true, members: n('member:'), messages: n('messages:'), forms: n('form:') };
      }
      default: return { ok: false, error: 'unknown message' };
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
  return true; // 非同期で返す
});
