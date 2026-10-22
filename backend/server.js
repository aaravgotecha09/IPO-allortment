'use strict';

/*
 * IPO Share Allotment API
 * -----------------------
 * The allotment logic lives in c/ipo.c (unchanged). This server starts one
 * compiled copy of that program per browser session, types the menu choices
 * and inputs into it, reads what it prints, and returns the result as JSON.
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

const PORT = Number(process.env.PORT) || 10000;
const BIN = process.env.IPO_BIN || path.join(__dirname, 'bin', 'ipo');
const IDLE_MS = Number(process.env.SESSION_IDLE_MS) || 15 * 60 * 1000;
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS) || 100;
const STEP_TIMEOUT_MS = 5000;
const INT_MAX = 2147483647;
const SHARE_LIMIT = 1000000000;

const MENU_MARK = '===== IPO SHARE ALLOTMENT SYSTEM =====';
const MAIN_PROMPT = 'Enter choice: ';
const PROMPT_RE = /Enter total shares in the IPO: |Enter retail lot size: |Enter quota for \w+: |Enter numeric PAN ID: |Category: 1\.Retail {2}2\.sNII {2}3\.bNII {2}4\.QIB: |Enter shares applied for: |Enter application number to search: |Enter choice: /g;
const CATEGORY_NAMES = ['Retail', 'sNII', 'bNII', 'QIB'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- C program session ---------- */

class Session {
  constructor(id) {
    this.id = id;
    this.proc = null;
    this.buf = '';
    this.waiter = null;
    this.chain = Promise.resolve();
    this.touched = Date.now();
    this.resetState();
  }

  resetState() {
    this.ipo = null;
    this.appCount = 0;
    this.allotted = false;
  }

  kill() {
    const p = this.proc;
    this.proc = null;
    this.buf = '';
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.reject(new HttpError(500, 'Engine stopped.'));
    }
    if (p) {
      try { p.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }
  }

  fail(err) {
    if (!this.waiter) return;
    const w = this.waiter;
    this.waiter = null;
    clearTimeout(w.timer);
    w.reject(err);
  }

  /* Every prompt printed by ipo.c ends with ": " and the program then
     waits for input, so "output ends with ': '" means "your turn". */
  check() {
    if (this.waiter && this.buf.endsWith(': ')) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      const out = this.buf;
      this.buf = '';
      w.resolve(out);
    }
  }

  read() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        this.kill();
        this.resetState();
        reject(new HttpError(500, 'Engine timed out. Session was reset.'));
      }, STEP_TIMEOUT_MS);
      this.waiter = { resolve, reject, timer };
      this.check();
    });
  }

  async spawnEngine() {
    this.kill();
    const p = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc = p;
    this.buf = '';
    p.stdout.on('data', (d) => {
      if (this.proc !== p) return;
      this.buf += d.toString('utf8');
      this.check();
    });
    p.stdin.on('error', () => {});
    p.on('error', (err) => {
      if (this.proc !== p) return;
      this.proc = null;
      this.resetState();
      this.fail(new HttpError(500, 'Cannot start the C engine: ' + err.message));
    });
    p.on('exit', () => {
      if (this.proc !== p) return;
      this.proc = null;
      this.resetState();
      this.fail(new HttpError(500, 'Engine stopped unexpectedly. Please set up the IPO again.'));
    });
    await this.read(); // first menu
  }

  schedule(fn) {
    const task = this.chain.then(fn);
    this.chain = task.catch(() => {});
    return task;
  }

  /* Types each input line into the program, one prompt at a time. Stops as
     soon as the program is back at the main menu (so a rejected input can
     never leave stray numbers behind for the menu to misread). */
  run(inputs) {
    return this.schedule(async () => {
      this.touched = Date.now();
      if (!this.proc) await this.spawnEngine();
      const outs = [];
      for (const line of inputs) {
        if (!this.proc) throw new HttpError(500, 'Engine is not running.');
        this.proc.stdin.write(String(line) + '\n');
        const out = await this.read();
        outs.push(out);
        if (out.endsWith(MAIN_PROMPT)) break;
      }
      const last = outs[outs.length - 1] || '';
      if (!last.endsWith(MAIN_PROMPT)) {
        this.kill();
        this.resetState();
        throw new HttpError(500, 'Engine out of sync. Session was reset.');
      }
      return cleanOutput(outs.join(''));
    });
  }

  restart() {
    return this.schedule(async () => {
      this.kill();
      this.resetState();
    });
  }
}

/* ---------- output parsing ---------- */

function cleanOutput(text) {
  const i = text.lastIndexOf(MENU_MARK);
  const body = (i >= 0 ? text.slice(0, i) : text).replace(PROMPT_RE, '');
  return body.replace(/\r/g, '').trim();
}

function firstLine(text) {
  return text.split('\n').map((l) => l.trim()).find(Boolean) || 'Request failed.';
}

const CAT = '(Retail|sNII|bNII|QIB)';
const ROW_APP = new RegExp(`^(\\d+)\\s+(\\d+)\\s+${CAT}\\s+(\\d+)$`);
const ROW_RESULT = new RegExp(`^(\\d+)\\s+(\\d+)\\s+${CAT}\\s+(\\d+)\\s+(\\d+)$`);
const ROW_SUMMARY = new RegExp(`^${CAT}\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)$`);
const SEARCH_RE = /Application No : (\d+)\s+PAN ID\s+: (\d+)\s+Category\s+: (\S+)\s+Shares applied : (\d+)\s+Shares allotted: (\d+)/;

const lines = (text) => text.split('\n').map((l) => l.trim());

function parseApplications(text) {
  return lines(text)
    .map((l) => ROW_APP.exec(l))
    .filter(Boolean)
    .map((m) => ({ appNo: +m[1], pan: +m[2], category: m[3], shares: +m[4] }));
}

function parseResults(text) {
  const rows = lines(text)
    .map((l) => ROW_RESULT.exec(l))
    .filter(Boolean)
    .map((m) => ({ appNo: +m[1], pan: +m[2], category: m[3], applied: +m[4], allotted: +m[5] }));
  const summary = lines(text)
    .map((l) => ROW_SUMMARY.exec(l))
    .filter(Boolean)
    .map((m) => ({ category: m[1], quota: +m[2], demand: +m[3], allotted: +m[4] }));
  return { results: rows, summary };
}

/* ---------- validation ---------- */

function toInt(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d{1,10}$/.test(v.trim())) return Number(v.trim());
  return NaN;
}

function needInt(v, name, min, max) {
  const n = toInt(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${name} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

/* ---------- sessions ---------- */

const sessions = new Map();

function getSession(req) {
  const id = req.get('x-session-id') || '';
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    throw new HttpError(400, 'Missing or invalid X-Session-Id header.');
  }
  let s = sessions.get(id);
  if (!s) {
    if (sessions.size >= MAX_SESSIONS) evictOldest();
    s = new Session(id);
    sessions.set(id, s);
  }
  s.touched = Date.now();
  return s;
}

function evictOldest() {
  let oldest = null;
  for (const s of sessions.values()) if (!oldest || s.touched < oldest.touched) oldest = s;
  if (oldest && Date.now() - oldest.touched > 60 * 1000) {
    oldest.kill();
    sessions.delete(oldest.id);
    return;
  }
  throw new HttpError(503, 'Server is busy. Please try again in a minute.');
}

function closeAll() {
  for (const s of sessions.values()) s.kill();
  sessions.clear();
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.touched > IDLE_MS) {
      s.kill();
      sessions.delete(id);
    }
  }
}, 60 * 1000);
sweeper.unref();

/* ---------- app ---------- */

const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors({
  origin: allowed.length ? allowed : '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Session-Id'],
}));
app.use(express.json({ limit: '10kb' }));

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

app.get('/', (req, res) => {
  res.json({ service: 'IPO Share Allotment API', status: 'ok', health: '/api/health' });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, sessions: sessions.size, uptimeSeconds: Math.round(process.uptime()) });
});

app.get('/api/state', ah(async (req, res) => {
  const s = getSession(req);
  res.json({ ok: true, ipo: s.ipo, applicationCount: s.appCount, allotted: s.allotted });
}));

app.post('/api/setup', ah(async (req, res) => {
  const s = getSession(req);
  const b = req.body || {};
  const total = needInt(b.totalShares, 'Total shares', 1, SHARE_LIMIT);
  const lot = needInt(b.lotSize, 'Lot size', 1, total);
  if (!Array.isArray(b.quotas) || b.quotas.length !== 4) {
    throw new HttpError(400, 'Provide 4 quotas: Retail, sNII, bNII, QIB.');
  }
  const quotas = b.quotas.map((v, i) => needInt(v, `${CATEGORY_NAMES[i]} quota`, 0, total));
  const sum = quotas.reduce((a, c) => a + c, 0);
  if (sum !== total) {
    throw new HttpError(400, `Category quotas must add up to ${total} (currently ${sum}).`);
  }

  await s.restart(); // a new IPO always starts from a fresh engine
  const out = await s.run(['1', total, lot, ...quotas]);
  if (!/IPO setup successful\./.test(out)) throw new HttpError(400, firstLine(out));

  s.ipo = {
    totalShares: total,
    lotSize: lot,
    quotas: { Retail: quotas[0], sNII: quotas[1], bNII: quotas[2], QIB: quotas[3] },
  };
  res.status(201).json({ ok: true, message: 'IPO setup successful.', ipo: s.ipo });
}));

app.post('/api/applications', ah(async (req, res) => {
  const s = getSession(req);
  if (!s.ipo) throw new HttpError(400, 'Set up the IPO first.');
  const b = req.body || {};
  const pan = needInt(b.pan, 'PAN ID', 1, INT_MAX);
  const category = needInt(b.category, 'Category', 1, 4);
  const shares = needInt(b.shares, 'Shares', 1, SHARE_LIMIT);
  if (category === 1 && shares % s.ipo.lotSize !== 0) {
    throw new HttpError(400, `Retail applications must be in multiples of ${s.ipo.lotSize} shares.`);
  }

  const out = await s.run(['2', pan, category, shares]);
  const m = /Application added successfully\. Application number: (\d+)/.exec(out);
  if (!m) {
    const msg = firstLine(out);
    throw new HttpError(/Duplicate/.test(msg) ? 409 : 400, msg);
  }
  s.appCount += 1;
  s.allotted = false;
  res.status(201).json({ ok: true, appNo: Number(m[1]), message: `Application #${m[1]} added.` });
}));

app.get('/api/applications', ah(async (req, res) => {
  const s = getSession(req);
  if (!s.appCount) return res.json({ ok: true, applications: [] });
  const out = await s.run(['5']);
  res.json({ ok: true, applications: parseApplications(out) });
}));

app.get('/api/search', ah(async (req, res) => {
  const s = getSession(req);
  const appNo = needInt(req.query.appNo, 'Application number', 1, INT_MAX);
  if (!s.appCount) throw new HttpError(404, 'No applications to search.');
  const out = await s.run(['4', appNo]);
  const m = SEARCH_RE.exec(out);
  if (!m) return res.status(404).json({ ok: false, found: false, error: 'Application not found.' });
  res.json({
    ok: true,
    found: true,
    application: { appNo: +m[1], pan: +m[2], category: m[3], shares: +m[4], allotted: +m[5] },
  });
}));

app.post('/api/allot', ah(async (req, res) => {
  const s = getSession(req);
  if (!s.ipo) throw new HttpError(400, 'Set up the IPO first.');
  if (!s.appCount) throw new HttpError(400, 'Add applications first.');
  const out = await s.run(['3']);
  if (!/Allotment calculation completed\./.test(out)) throw new HttpError(400, firstLine(out));
  s.allotted = true;
  res.json({ ok: true, ...parseResults(out) });
}));

app.get('/api/results', ah(async (req, res) => {
  const s = getSession(req);
  if (!s.allotted) throw new HttpError(400, 'Calculate allotment first.');
  const out = await s.run(['6']);
  res.json({ ok: true, ...parseResults(out) });
}));

app.post('/api/reset', ah(async (req, res) => {
  const s = getSession(req);
  await s.restart();
  res.json({ ok: true, message: 'Session reset.' });
}));

app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    ok: false,
    error: err instanceof HttpError || status < 500 ? err.message : 'Internal server error.',
  });
});

/* ---------- start ---------- */

if (require.main === module) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`IPO API listening on port ${PORT} (engine: ${BIN})`);
  });
  const stop = () => {
    closeAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { app, sessions, closeAll };
