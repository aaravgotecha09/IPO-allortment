(() => {
  'use strict';

  /* ---------- config ---------- */
  const cfg = window.APP_CONFIG || {};
  const isLocal = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  const API_BASE = (isLocal ? 'http://localhost:10000' : cfg.API_BASE || '').replace(/\/+$/, '');
  const CLASS = { Retail: 'retail', sNII: 'snii', bNII: 'bnii', QIB: 'qib' };
  const NAMES = ['Retail', 'sNII', 'bNII', 'QIB'];

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (n) => Number(n).toLocaleString('en-IN');
  const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const rf = (a, b) => a + Math.random() * (b - a);

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
  function loadSid() {
    try {
      let id = localStorage.getItem('ipo_sid');
      if (!id) { id = newId(); localStorage.setItem('ipo_sid', id); }
      return id;
    } catch (_) { return newId(); }
  }
  const SID = loadSid();

  let toastTimer;
  function toast(msg, kind = 'ok') {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (kind === 'err' ? ' err' : kind === 'warn' ? ' warn' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), kind === 'err' ? 5000 : 2800);
  }

  function setStatus(kind, text) {
    const p = $('apiStatus');
    p.className = 'pill pill-' + kind;
    p.textContent = text;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function cell(content, cls) {
    const c = el('td', cls);
    if (content instanceof Node) c.appendChild(content); else c.textContent = content;
    return c;
  }
  const badge = (name) => el('span', 'badge ' + CLASS[name], name);

  /* ---------- API ---------- */
  async function api(path, { method = 'GET', body } = {}) {
    if (!API_BASE || API_BASE.includes('YOUR-RENDER')) {
      throw new Error('Backend URL is not set. Edit frontend/config.js.');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 70000);
    try {
      const res = await fetch(API_BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': SID },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      let data = null;
      try { data = await res.json(); } catch (_) { /* not json */ }
      if (!res.ok) {
        const err = new Error((data && data.error) || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The server took too long to respond.');
      if (e instanceof TypeError) throw new Error('Cannot reach the server.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function waitForServer() {
    if (!API_BASE || API_BASE.includes('YOUR-RENDER')) {
      setStatus('bad', 'Backend URL not set');
      const b = $('banner');
      b.hidden = false;
      b.textContent = 'Backend URL is not set. Open frontend/config.js and set API_BASE to your Render URL.';
      return false;
    }
    setStatus('wait', 'Connecting…');
    const slow = setTimeout(() => setStatus('wait', 'Waking up server (can take ~1 min)…'), 3000);
    for (let i = 0; i < 10; i++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 65000);
        const res = await fetch(API_BASE + '/api/health', { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) { clearTimeout(slow); setStatus('ok', 'Server online'); return true; }
      } catch (_) { /* retry */ }
      await sleep(3000);
    }
    clearTimeout(slow);
    setStatus('bad', 'Server offline');
    return false;
  }

  /* ---------- busy wrapper ---------- */
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); }
    catch (e) { toast(e.message, 'err'); }
    finally { if (btn) btn.disabled = false; }
  }

  /* ---------- state + rendering ---------- */
  const state = { ipo: null, pans: new Set() };

  /* ---------- random data ---------- */
  function randomIpo() {
    const lot = [5, 10, 20, 25, 50][rnd(0, 4)];
    const lots = rnd(100, 400);
    const total = lot * lots;
    const retail = Math.max(lot, Math.round(lots * rf(0.15, 0.35)) * lot);
    const rest = total - retail;
    const snii = Math.round(rest * rf(0.15, 0.3));
    const bnii = Math.round(rest * rf(0.2, 0.35));
    return { totalShares: total, lotSize: lot, quotas: [retail, snii, bnii, rest - snii - bnii] };
  }

  function randomApps(n, ipo) {
    const q = NAMES.map((name) => ipo.quotas[name]);
    const cats = [];
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const c = r < 0.6 ? 0 : r < 0.75 ? 1 : r < 0.9 ? 2 : 3;
      cats.push(c);
      counts[c]++;
    }
    const demandFactor = q.map(() => rf(0.5, 3)); // some categories oversubscribed, some not
    return cats.map((c) => {
      let pan;
      do { pan = rnd(100000, 99999999); } while (state.pans.has(pan));
      state.pans.add(pan);
      const per = Math.max(1, (q[c] * demandFactor[c]) / counts[c]);
      let shares = Math.max(1, Math.round(per * rf(0.5, 1.5)));
      if (c === 0) shares = Math.max(1, Math.round(shares / ipo.lotSize)) * ipo.lotSize;
      return { pan, category: c + 1, shares };
    });
  }

  async function addBulk(list) {
    let added = 0;
    let rejected = 0;
    for (let i = 0; i < list.length; i += 100) {
      try {
        const r = await api('/api/applications/bulk', { method: 'POST', body: { applications: list.slice(i, i + 100) } });
        added += r.added;
        rejected += r.rejected;
      } catch (e) {
        rejected += Math.min(100, list.length - i);
        if (e.status && e.status !== 400) throw e;
      }
    }
    return { added, rejected };
  }

  function renderIpo() {
    const info = $('ipoInfo');
    const card = $('cardApply');
    if (!state.ipo) {
      info.hidden = true;
      card.classList.add('locked');
      $('applyHint').textContent = 'Create the IPO first.';
      return;
    }
    const { totalShares, lotSize, quotas } = state.ipo;
    info.hidden = false;
    info.replaceChildren();
    const line = el('div');
    const b = el('b', null, 'IPO is live: ');
    line.append(b, `${fmt(totalShares)} shares, retail lot size ${fmt(lotSize)}`);
    info.appendChild(line);
    const chips = el('div', 'chips');
    NAMES.forEach((n) => chips.appendChild(el('span', 'chip', `${n}: ${fmt(quotas[n])}`)));
    info.appendChild(chips);
    card.classList.remove('locked');
    $('applyHint').textContent = `Retail applications must be multiples of ${fmt(lotSize)} shares.`;
  }

  function renderApps(list) {
    const body = $('tblApps').querySelector('tbody');
    body.replaceChildren();
    list.forEach((a) => {
      const tr = el('tr');
      tr.append(cell(a.appNo), cell(a.pan), cell(badge(a.category)), cell(fmt(a.shares), 'num'));
      body.appendChild(tr);
    });
    state.pans = new Set(list.map((a) => a.pan));
    $('appCount').textContent = list.length;
    $('emptyApps').hidden = list.length > 0;
    $('tblApps').parentElement.hidden = list.length === 0;
  }

  function clearResults() {
    $('summary').replaceChildren();
    $('tblResults').querySelector('tbody').replaceChildren();
    $('resultWrap').hidden = true;
    $('emptyResults').hidden = false;
  }

  function renderResults(data) {
    const sum = $('summary');
    sum.replaceChildren();
    data.summary.forEach((c) => {
      const card = el('div', 'sum-card ' + CLASS[c.category]);
      const h = el('h3');
      h.append(badge(c.category), el('small', null, c.quota ? (c.demand / c.quota).toFixed(2) + 'x subscribed' : 'no quota'));
      const dl = el('dl');
      [['Quota', c.quota], ['Demand', c.demand], ['Allotted', c.allotted]].forEach(([k, v]) => {
        dl.append(el('dt', null, k), el('dd', null, fmt(v)));
      });
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = (c.quota ? Math.min(100, (c.allotted / c.quota) * 100) : 0) + '%';
      bar.appendChild(fill);
      card.append(h, dl, bar);
      sum.appendChild(card);
    });

    const body = $('tblResults').querySelector('tbody');
    body.replaceChildren();
    data.results.forEach((r) => {
      const tr = el('tr');
      const kind = r.allotted === 0 ? 'none' : r.allotted >= r.applied ? 'full' : 'part';
      const label = kind === 'none' ? 'Not allotted' : kind === 'full' ? 'Full' : 'Partial';
      tr.append(
        cell(r.appNo), cell(r.pan), cell(badge(r.category)),
        cell(fmt(r.applied), 'num'), cell(fmt(r.allotted), 'num'),
        cell(el('span', 'status ' + kind, label))
      );
      body.appendChild(tr);
    });
    $('resultWrap').hidden = false;
    $('emptyResults').hidden = true;
  }

  function showSearch(content, bad) {
    const box = $('searchResult');
    box.hidden = false;
    box.className = 'search-result' + (bad ? ' bad' : '');
    box.replaceChildren();
    if (typeof content === 'string') { box.textContent = content; return; }
    const a = content;
    [['Application no.', a.appNo], ['PAN ID', a.pan], ['Category', badge(a.category)],
     ['Shares applied', fmt(a.shares)], ['Shares allotted', fmt(a.allotted)]].forEach(([k, v]) => {
      const s = el('span');
      s.appendChild(el('small', null, k));
      const b = el('b');
      if (v instanceof Node) b.appendChild(v); else b.textContent = v;
      s.appendChild(b);
      box.appendChild(s);
    });
  }

  async function refreshApps() {
    const d = await api('/api/applications');
    renderApps(d.applications);
  }

  async function loadState() {
    const s = await api('/api/state');
    state.ipo = s.ipo;
    renderIpo();
    if (s.applicationCount > 0) await refreshApps(); else renderApps([]);
    if (s.allotted) renderResults(await api('/api/results')); else clearResults();
  }

  /* ---------- setup form ---------- */
  const quotaInputs = () => Array.from(document.querySelectorAll('[data-quota]'));
  const num = (v) => (v === '' || v === null ? NaN : Number(v));

  function updateQuotaSum() {
    const total = num($('totalShares').value) || 0;
    const sum = quotaInputs().reduce((a, i) => a + (num(i.value) || 0), 0);
    const p = $('quotaSum');
    p.textContent = `Quotas total: ${fmt(sum)} / ${fmt(total)}`;
    p.className = 'sum ' + (total > 0 && sum === total ? 'sum-ok' : 'sum-warn');
  }

  async function createIpo(payload) {
    const r = await api('/api/setup', { method: 'POST', body: payload });
    state.ipo = r.ipo;
    renderIpo();
    renderApps([]);
    clearResults();
    $('searchResult').hidden = true;
  }

  $('formSetup').addEventListener('input', updateQuotaSum);

  $('formSetup').addEventListener('submit', (e) => {
    e.preventDefault();
    const total = num($('totalShares').value);
    const lot = num($('lotSize').value);
    const quotas = quotaInputs().map((i) => num(i.value));
    if (!Number.isInteger(total) || total < 1) return toast('Enter total shares (whole number, at least 1).', 'warn');
    if (!Number.isInteger(lot) || lot < 1 || lot > total) return toast('Lot size must be between 1 and total shares.', 'warn');
    if (quotas.some((q) => !Number.isInteger(q) || q < 0)) return toast('Quotas must be whole numbers, 0 or more.', 'warn');
    const sum = quotas.reduce((a, b) => a + b, 0);
    if (sum !== total) return toast(`Quotas add up to ${fmt(sum)}, but total shares is ${fmt(total)}.`, 'warn');
    busy(e.submitter || null, async () => {
      await createIpo({ totalShares: total, lotSize: lot, quotas });
      toast('IPO created. You can add applications now.');
    });
  });

  $('btnSample').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    busy(btn, async () => {
      const ipo = randomIpo();
      $('totalShares').value = ipo.totalShares;
      $('lotSize').value = ipo.lotSize;
      quotaInputs().forEach((i, k) => { i.value = ipo.quotas[k]; });
      updateQuotaSum();
      await createIpo(ipo);
      toast('Random IPO created. Adding applications…');
      const { added } = await addBulk(randomApps(rnd(15, 30), state.ipo));
      await refreshApps();
      toast(`Random sample ready: ${added} applications. Press "Calculate allotment".`);
    });
  });

  $('btnRandom').addEventListener('click', (e) => {
    const n = num($('randCount').value);
    if (!state.ipo) return toast('Create the IPO first.', 'warn');
    if (!Number.isInteger(n) || n < 1 || n > 500) return toast('Enter a number between 1 and 500.', 'warn');
    busy(e.currentTarget, async () => {
      toast(`Generating ${n} random applications…`);
      const { added, rejected } = await addBulk(randomApps(n, state.ipo));
      clearResults();
      await refreshApps();
      toast(rejected ? `Added ${added}, rejected ${rejected}.` : `Added ${added} random applications.`, rejected ? 'warn' : 'ok');
    });
  });

  /* ---------- add application ---------- */
  $('formApply').addEventListener('submit', (e) => {
    e.preventDefault();
    const pan = num($('pan').value);
    const category = num($('category').value);
    const shares = num($('shares').value);
    if (!Number.isInteger(pan) || pan < 1) return toast('Enter a numeric PAN ID (1 or more).', 'warn');
    if (!Number.isInteger(shares) || shares < 1) return toast('Enter the number of shares applied for.', 'warn');
    if (category === 1 && state.ipo && shares % state.ipo.lotSize !== 0) {
      return toast(`Retail shares must be a multiple of ${state.ipo.lotSize}.`, 'warn');
    }
    busy(e.submitter || null, async () => {
      const r = await api('/api/applications', { method: 'POST', body: { pan, category, shares } });
      toast(r.message);
      $('pan').value = '';
      $('shares').value = '';
      $('pan').focus();
      clearResults();
      await refreshApps();
    });
  });

  /* ---------- search ---------- */
  $('formSearch').addEventListener('submit', (e) => {
    e.preventDefault();
    const n = num($('searchNo').value);
    if (!Number.isInteger(n) || n < 1) return toast('Enter an application number.', 'warn');
    busy(e.submitter || null, async () => {
      try {
        const r = await api('/api/search?appNo=' + n);
        showSearch(r.application, false);
      } catch (err) {
        if (err.status === 404) showSearch(err.message, true); else throw err;
      }
    });
  });

  /* ---------- allotment ---------- */
  $('btnAllot').addEventListener('click', (e) => {
    busy(e.currentTarget, async () => {
      renderResults(await api('/api/allot', { method: 'POST' }));
      toast('Allotment calculated.');
      $('cardAllot').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ---------- reset ---------- */
  $('btnReset').addEventListener('click', (e) => {
    if (!confirm('Clear this session and start over?')) return;
    busy(e.currentTarget, async () => {
      await api('/api/reset', { method: 'POST' });
      state.ipo = null;
      renderIpo();
      renderApps([]);
      clearResults();
      $('searchResult').hidden = true;
      $('formSetup').reset();
      updateQuotaSum();
      toast('Session reset.');
    });
  });

  /* ---------- start ---------- */
  (async function init() {
    updateQuotaSum();
    renderApps([]);
    clearResults();
    renderIpo();
    if (await waitForServer()) {
      try { await loadState(); } catch (e) { toast(e.message, 'err'); }
    }
  })();
})();
