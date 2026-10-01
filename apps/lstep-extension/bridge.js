// beyond line の画面(ページ)と拡張機能の橋渡し。画面からの「集めたデータをください」に答えるだけ。
// データはこの画面(beyond line)だけに渡す。許可する操作は 一覧・取得・削除 のみ。
(() => {
  const ALLOWED = new Set(['list', 'get', 'delete']);
  const VERSION = chrome.runtime.getManifest().version;
  document.documentElement.dataset.lstepExtension = VERSION;
  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.source !== 'beyond-line-page' || !ALLOWED.has(d.type)) return;
    let res;
    try { res = await chrome.runtime.sendMessage({ type: d.type, pkg: d.pkg }); } catch (err) { res = { ok: false, error: String(err) }; }
    window.postMessage({ source: 'beyond-line-extension', id: d.id, type: d.type, ...res }, window.location.origin);
  });
  window.postMessage({ source: 'beyond-line-extension', type: 'ready', version: VERSION }, window.location.origin);
})();
