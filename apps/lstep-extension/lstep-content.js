// Lステップの画面の中で動く収集処理。画面の右下に小さなパネルを出し、「収集を開始」で
// 友だち一覧 → CSV → 友だち情報欄・タグの定義 → 回答フォーム → 友だちごとのデータ → トーク履歴 の順に集める。
// 画面を移動する手順があるので、進み具合は chrome.storage.local の `lstepJob` に残し、移動後に続きから再開する。
// 集めたデータは background.js(拡張機能の中)に保存する。外部には送らない。
(() => {
  if (window.top !== window) return;
  if (window.__beyondLstepCollector) return;
  window.__beyondLstepCollector = true;

  const STEPS = ['list', 'csv', 'fielddefs', 'tagdefs', 'forms', 'members', 'messages', 'finish'];
  const LABEL = {
    list: '友だち一覧', csv: 'CSVの書き出し', fielddefs: '友だち情報欄の定義', tagdefs: 'タグの定義',
    forms: '回答フォーム', members: '友だちごとの情報・タグ', messages: 'トーク履歴', finish: '仕上げ',
  };
  const ADMIN_URL = 'https://beyond-line-admin.cms-manager.jp/imports';
  const BASIC_COLS = ['ID', '表示名', 'LINE登録名', '本名', 'システム表示名', 'ステータスメッセージ', '個別メモ', '友だち追加日時', '対応マーク', '表示状態', 'ユーザーブロック', '最終メッセージ', '最終メッセージ日時', '購読中シナリオ', 'シナリオ日数'];

  // ── 小道具 ──────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, timeout = 20000, interval = 200) {
    const t0 = Date.now();
    for (;;) {
      try { const v = fn(); if (v) return v; } catch { /* まだ画面が出来ていない */ }
      if (Date.now() - t0 > timeout) return null;
      await sleep(interval);
    }
  }
  const bg = (msg) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res || !res.ok) return reject(new Error((res && res.error) || 'background error'));
      resolve(res);
    });
  });
  const getJob = () => new Promise((r) => chrome.storage.local.get('lstepJob', (v) => r(v.lstepJob || null)));
  const setJob = (job) => new Promise((r) => chrome.storage.local.set({ lstepJob: job }, r));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const stripIcons = (s) => clean(s.replace(/drag_indicator|folder_open|folder|more_vert|star|settings/g, ' '));

  function parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  const decodeSjis = (buf) => new TextDecoder('shift_jis').decode(buf);

  function accountNameFromPage() {
    const lines = document.body.innerText.split('\n').map(clean).filter(Boolean);
    const i = lines.findIndex((l) => /\(管理者\)|\(オーナー\)|\(スタッフ\)/.test(l));
    if (i >= 0 && lines[i + 1] && lines[i + 1] !== 'expand_more') return lines[i + 1];
    return '';
  }

  // ── パネル(画面右下) ───────────────────────────────────────
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      .p{font:13px/1.5 -apple-system,'Hiragino Sans','Yu Gothic',sans-serif;background:#111;color:#f3f3f3;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);width:300px;padding:14px 16px}
      h1{font-size:13px;margin:0 0 8px;font-weight:700}
      .row{display:flex;gap:8px;margin-top:10px}
      button{flex:1;border:0;border-radius:8px;padding:8px 10px;font:inherit;cursor:pointer;background:#06c755;color:#fff;font-weight:600}
      button.sub{background:#333;color:#ddd}
      button:disabled{opacity:.4;cursor:default}
      input{width:100%;box-sizing:border-box;border:1px solid #444;background:#1c1c1c;color:#fff;border-radius:6px;padding:6px 8px;font:inherit}
      label{display:block;font-size:11px;color:#aaa;margin:6px 0 2px}
      .bar{height:6px;background:#333;border-radius:3px;overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;background:#06c755;width:0}
      .msg{margin-top:8px;color:#ccc;word-break:break-all}.warn{color:#ffb454}
      .x{float:right;background:none;color:#888;flex:none;padding:0 4px;font-size:16px}
      a{color:#06c755}
    </style>
    <div class="p">
      <button class="x" title="小さくする">–</button>
      <h1>beyond line 引き継ぎ</h1>
      <div id="body"></div>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = (sel) => root.querySelector(sel);
  const body = $('#body');
  let collapsed = false;
  $('.x').onclick = () => { collapsed = !collapsed; body.style.display = collapsed ? 'none' : ''; };

  function render({ job, text, progress, warn }) {
    const running = job && job.step && job.step !== 'done' && !job.stopped;
    const idx = job && job.step ? STEPS.indexOf(job.step) : -1;
    const pct = job ? (job.step === 'done' ? 100 : Math.round(((Math.max(idx, 0) + (progress || 0)) / STEPS.length) * 100)) : 0;
    let html = '';
    if (!job || job.stopped) {
      html += `<label>このアカウントの名前(beyond line 側の表示用)</label><input id="acc" value="${(job && job.accountName) || accountNameFromPage()}">`;
      html += `<div class="msg">この画面を前面に開いたまま、完了までお待ちください(数分〜10分ほど)。他のタブへ切り替えても動きますが、遅くなります。</div>`;
      html += `<div class="row"><button id="go">収集を開始</button></div>`;
      if (job && job.stopped) html += `<div class="msg warn">途中で止めました。「収集を開始」で続きから再開します。</div>`;
    } else if (job.step === 'done') {
      html += `<div class="msg">収集が終わりました(${job.accountName})。</div>`;
      if (job.warnings && job.warnings.length) html += `<div class="msg warn">注意 ${job.warnings.length}件: ${job.warnings.slice(0, 3).join(' / ')}</div>`;
      html += `<div class="row"><button id="open">beyond line で取り込む</button></div><div class="row"><button class="sub" id="reset">もう一度集める</button></div>`;
    } else {
      html += `<div class="msg"><b>${LABEL[job.step] || job.step}</b>(${idx + 1}/${STEPS.length})</div><div class="bar"><i style="width:${pct}%"></i></div>`;
      if (text) html += `<div class="msg">${text}</div>`;
      if (warn) html += `<div class="msg warn">${warn}</div>`;
      html += `<div class="row"><button class="sub" id="stop">止める</button></div>`;
    }
    body.innerHTML = html;
    const on = (id, fn) => { const el = body.querySelector('#' + id); if (el) el.onclick = fn; };
    on('go', startOrResume); on('stop', stop); on('open', () => window.open(ADMIN_URL, '_blank')); on('reset', reset);
  }

  // ── 全体の流れ ─────────────────────────────────────────────
  let cancelled = false;
  const progress = (job, text, frac, warn) => render({ job, text, progress: frac, warn });
  const checkCancel = () => { if (cancelled) throw new Error('__cancelled__'); };

  async function startOrResume() {
    let job = await getJob();
    const accInput = body.querySelector('#acc');
    if (!job || job.step === 'done') {
      const id = 'pkg-' + Date.now();
      job = { pkg: id, step: STEPS[0], accountName: (accInput && accInput.value.trim()) || accountNameFromPage() || 'Lステップ', startedAt: new Date().toISOString(), warnings: [] };
    } else {
      job.stopped = false;
      if (accInput && accInput.value.trim()) job.accountName = accInput.value.trim();
    }
    await setJob(job);
    cancelled = false;
    run();
  }
  async function stop() {
    cancelled = true;
    const job = await getJob();
    if (job) { job.stopped = true; await setJob(job); render({ job }); }
  }
  async function reset() {
    const job = await getJob();
    if (job && job.pkg) { try { await bg({ type: 'delete', pkg: job.pkg }); } catch { /* 残っていても害はない */ } }
    await setJob(null);
    render({ job: null });
  }

  async function run() {
    let job = await getJob();
    while (job && job.step && job.step !== 'done' && !job.stopped) {
      const step = job.step;
      progress(job, '準備中…', 0);
      let result;
      try {
        result = await STEP_FN[step](job);
      } catch (e) {
        if (String(e && e.message) === '__cancelled__') return;
        job = (await getJob()) || job;
        job.warnings.push(`${LABEL[step]}: ${String(e && e.message ? e.message : e)}`);
        job.step = STEPS[STEPS.indexOf(step) + 1] || 'done';
        await setJob(job);
        continue;
      }
      if (result === 'navigating') return; // 画面を移動した。移動先で続きから再開する
      job = (await getJob()) || job;
      if (job.stopped) return;
      job.step = STEPS[STEPS.indexOf(step) + 1] || 'done';
      await setJob(job);
    }
    render({ job: await getJob() });
  }

  const onPath = (re) => re.test(location.pathname);
  function goto(url) { location.href = url; return 'navigating'; }

  // ── 各ステップ ─────────────────────────────────────────────
  const STEP_FN = {
    // 友だち一覧: ページ送りを順に押して、行を読む(一覧のデータは通信では取れないため、画面から読む)
    async list(job) {
      if (!onPath(/^\/line\/show\/?$/)) return goto('/line/show');
      await waitFor(() => document.querySelector('tr[data-item-id]'), 40000);
      const out = {};
      const sig = () => [...document.querySelectorAll('tr[data-item-id]')].map((r) => r.dataset.itemId).join(',');
      const pageButton = (n) => [...document.querySelectorAll('li button')].find((b) => clean(b.innerText) === String(n));
      let page = 1;
      for (;;) {
        checkCancel();
        for (const r of document.querySelectorAll('tr[data-item-id]')) {
          const a = r.querySelector('a'); const img = r.querySelector('img');
          out[r.dataset.itemId] = { name: clean(a && a.textContent), pic: img ? img.getAttribute('src') : null, row: clean(r.innerText).slice(0, 200) };
        }
        progress(job, `${page}ページ目まで読みました(${Object.keys(out).length}人)`, Math.min(page / 20, 0.95));
        const next = pageButton(page + 1);
        if (!next) break;
        const before = sig();
        next.click();
        const changed = await waitFor(() => sig() && sig() !== before, 30000);
        if (!changed) { job.warnings.push(`友だち一覧: ${page + 1}ページ目に進めませんでした`); break; }
        page++;
        if (page > 400) break;
      }
      await bg({ type: 'put', pkg: job.pkg, items: [['list', out]] });
      job.listCount = Object.keys(out).length;
      await setJob(job);
    },

    // CSV: 友だち一覧の「CSV操作 → CSVエクスポート」から、基本項目を全部選んで書き出し、結果を取る
    async csv(job) {
      const path = location.pathname;
      if (/^\/line\/exporter\/[^/]+\/list/.test(path)) return csvResult(job);
      if (/^\/line\/exporter\/[^/]+\/register/.test(path)) return csvRegister(job);
      if (!onPath(/^\/line\/show\/?$/)) return goto('/line/show');
      progress(job, 'CSVエクスポートの画面を開きます', 0.1);
      const menu = await waitFor(() => [...document.querySelectorAll('button')].find((b) => /CSV操作/.test(b.innerText)), 30000);
      if (!menu) throw new Error('「CSV操作」ボタンが見つかりません');
      menu.click();
      const item = await waitFor(() => [...document.querySelectorAll('a,button,li')].find((e) => /^\s*(download\s*)?CSVエクスポート\s*$/.test(e.innerText || '')), 10000);
      if (!item) throw new Error('「CSVエクスポート」が見つかりません');
      item.click();
      const ok = await waitFor(() => /^\/line\/exporter\/[^/]+\/register/.test(location.pathname), 20000);
      if (!ok) throw new Error('CSVエクスポートの画面に進めませんでした');
      return csvRegister(job);
    },

    // 友だち情報欄・タグの定義: フォルダを順にクリックして、表の行を読む
    async fielddefs(job) { return readDefs(job, '/line/var', 'fieldDefs', '友だち情報欄'); },
    async tagdefs(job) { return readDefs(job, '/line/tag', 'tagDefs', 'タグ'); },

    // 回答フォーム: 一覧からフォームを集めて、回答CSVを取る
    async forms(job) {
      if (!onPath(/^\/line\/form\/?$/)) return goto('/line/form');
      await waitFor(() => document.querySelector('a[href*="/lvf/"]'), 30000);
      const found = new Map();
      const harvest = (folder) => {
        for (const a of document.querySelectorAll('a[href*="/lvf/"]')) {
          const m = (a.getAttribute('href') || '').match(/\/lvf\/(?:edit|show\/answer|export)\/(\d+)/);
          if (!m) continue;
          const row = a.closest('tr') || a.closest('li') || a.parentElement;
          const name = clean((row && (row.querySelector('a[href*="/lvf/edit/"]') || row.querySelector('a')) || a).textContent);
          const prev = found.get(m[1]);
          if (!prev || (!prev.name && name)) found.set(m[1], { lid: m[1], name, folder });
        }
      };
      const folderButtons = () => [...document.querySelectorAll('li.draggable button, [class*="folder"] button')].filter((b) => clean(b.innerText));
      harvest(null);
      const n = folderButtons().length;
      for (let i = 0; i < n; i++) {
        checkCancel();
        const b = folderButtons()[i]; if (!b) break;
        const folder = stripIcons(b.innerText).replace(/\s\d+$/, '');
        b.click();
        await sleep(1500);
        harvest(folder);
      }
      const forms = [...found.values()];
      job.formsFound = forms.length;
      for (let i = 0; i < forms.length; i++) {
        checkCancel();
        const f = forms[i];
        progress(job, `${f.name || f.lid}(${i + 1}/${forms.length})`, i / Math.max(forms.length, 1));
        try {
          const r = await fetch('/lvf/export/' + f.lid, { credentials: 'include' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const csvRows = parseCsv(decodeSjis(await r.arrayBuffer()));
          await bg({ type: 'put', pkg: job.pkg, items: [['form:' + f.lid, { lid: f.lid, name: f.name, folder: f.folder, csvRows }]] });
        } catch (e) { job.warnings.push(`フォーム ${f.name || f.lid}: ${e.message}`); }
        await sleep(400);
      }
      await setJob(job);
    },

    // 友だちごとの情報・タグ
    async members(job) {
      const list = await loadList(job);
      const ids = Object.keys(list);
      const have = new Set((await bg({ type: 'keys', pkg: job.pkg, prefix: 'member:' })).keys.map((k) => k.slice(7)));
      const todo = ids.filter((id) => !have.has(id));
      let buf = [];
      for (let i = 0; i < todo.length; i++) {
        checkCancel();
        const id = todo[i];
        const j = await fetchJson(`/api/member/data/${id}?ui_type=1`);
        buf.push(['member:' + id, j]);
        if (buf.length >= 25 || i === todo.length - 1) { await bg({ type: 'put', pkg: job.pkg, items: buf }); buf = []; }
        if (i % 5 === 0) progress(job, `${ids.length - todo.length + i + 1} / ${ids.length}人`, (ids.length - todo.length + i + 1) / ids.length);
        await sleep(120);
      }
    },

    // トーク履歴
    async messages(job) {
      const list = await loadList(job);
      const ids = Object.keys(list);
      const have = new Set((await bg({ type: 'keys', pkg: job.pkg, prefix: 'messages:' })).keys.map((k) => k.slice(9)));
      const todo = ids.filter((id) => !have.has(id));
      for (let i = 0; i < todo.length; i++) {
        checkCancel();
        const id = todo[i];
        const pages = [];
        let ptime = null;
        for (let p = 0; p < 200; p++) {
          const j = await fetchJson(`/api/member/messages/${id}?ui_type=1${ptime ? `&all_table=1&ptime=${ptime}` : ''}`);
          pages.push(j);
          const nxt = j.next_past_time;
          if (!nxt || j.lastpage || j.edgepage) break;
          ptime = nxt;
          await sleep(150);
        }
        await bg({ type: 'put', pkg: job.pkg, items: [['messages:' + id, pages]] });
        progress(job, `${ids.length - todo.length + i + 1} / ${ids.length}人`, (ids.length - todo.length + i + 1) / ids.length);
        await sleep(150);
      }
    },

    async finish(job) {
      await bg({ type: 'put', pkg: job.pkg, items: [
        ['meta', { collectedAt: new Date().toISOString(), lstepHost: location.host, accountName: job.accountName }],
        ['warnings', job.warnings || []],
      ] });
    },
  };

  async function loadList(job) {
    const res = await bg({ type: 'get', pkg: job.pkg });
    return res.data.list || {};
  }

  async function fetchJson(url, attempt = 0) {
    const r = await fetch(url, { credentials: 'include' });
    if (r.status === 401 || r.status === 403) throw new Error('Lステップのログインが切れました。ログインし直してから「収集を開始」を押してください(続きから再開します)');
    if (r.status === 429 || r.status >= 500) {
      if (attempt >= 5) throw new Error('HTTP ' + r.status);
      await sleep(3000 * (attempt + 1));
      return fetchJson(url, attempt + 1);
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function csvRegister(job) {
    progress(job, '書き出す項目を選びます', 0.3);
    await waitFor(() => document.querySelector('input[type=checkbox]'), 30000);
    const labelOf = (cb) => clean((cb.closest('label') || cb.parentElement || {}).innerText || '');
    let ticked = 0;
    for (const cb of document.querySelectorAll('input[type=checkbox]')) {
      if (BASIC_COLS.includes(labelOf(cb)) && !cb.checked) { cb.click(); ticked++; }
    }
    if (!ticked && ![...document.querySelectorAll('input[type=checkbox]')].some((cb) => cb.checked)) {
      for (const cb of document.querySelectorAll('input[type=checkbox]')) if (!cb.checked) cb.click();
    }
    await sleep(500);
    const dl = [...document.querySelectorAll('button')].find((b) => /この条件でダウンロード/.test(b.innerText));
    if (!dl) throw new Error('「この条件でダウンロード」が見つかりません');
    dl.click();
    const ok = await waitFor(() => /^\/line\/exporter\/[^/]+\/list/.test(location.pathname), 30000);
    if (!ok) throw new Error('書き出しの一覧に進めませんでした');
    return csvResult(job);
  }

  async function csvResult(job) {
    progress(job, 'CSVの書き出しを待っています', 0.6);
    const link = await waitFor(() => {
      const a = document.querySelector('a[href*="/line/exporter/result/"]');
      return a && !/処理中/.test(document.body.innerText) ? a : null;
    }, 180000, 1000);
    if (!link) throw new Error('CSVの書き出しが終わりませんでした');
    const r = await fetch(link.href, { credentials: 'include' });
    if (!r.ok) throw new Error('CSVを取得できませんでした(HTTP ' + r.status + ')');
    const csvRows = parseCsv(decodeSjis(await r.arrayBuffer()));
    await bg({ type: 'put', pkg: job.pkg, items: [['csvRows', csvRows]] });
    job.csvRowCount = csvRows.length;
    await setJob(job);
  }

  async function readDefs(job, path, key, label) {
    if (!onPath(new RegExp('^' + path.replace(/\//g, '\\/') + '\\/?$'))) return goto(path);
    await waitFor(() => document.querySelector('li.draggable button'), 30000);
    const defs = [];
    const buttons = () => [...document.querySelectorAll('li.draggable button')];
    const n = buttons().length;
    for (let i = 0; i < n; i++) {
      checkCancel();
      const b = buttons()[i]; if (!b) break;
      const folder = stripIcons(b.innerText).replace(/\s\d+$/, '');
      b.click();
      await sleep(1800);
      const gid = (location.search.match(/group=(\d+)/) || [])[1] || null;
      const rows = [...document.querySelectorAll('table tbody tr, [role=row]')].map((r) => clean(r.innerText)).filter((t) => t && !/作成されていません/.test(t));
      defs.push({ folder, gid, rows });
      progress(job, `${label}: ${i + 1} / ${n}フォルダ`, (i + 1) / n);
    }
    // フォルダごとに2回ずつ入るので、フォルダ名が空のものは捨て、同じものは1つにする
    const seen = new Set();
    const out = defs.filter((d) => { if (!d.folder) return false; const k = d.folder + '|' + d.gid; if (seen.has(k)) return false; seen.add(k); return true; });
    await bg({ type: 'put', pkg: job.pkg, items: [[key, out]] });
  }

  // ── 起動時: 続きがあれば再開、なければパネルだけ出す ─────────────
  (async () => {
    const job = await getJob();
    render({ job });
    if (job && job.step && job.step !== 'done' && !job.stopped) { cancelled = false; run(); }
  })();
})();
