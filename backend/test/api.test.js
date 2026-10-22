'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { app, closeAll } = require('../server');

let server;
let base;
const SID = 'test-session-0001';

async function call(method, url, body, sid = SID) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Session-Id': sid },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  closeAll();
  await new Promise((resolve) => server.close(resolve));
});

test('full IPO flow through the C engine', async () => {
  let r = await call('GET', '/api/health');
  assert.equal(r.status, 200);

  r = await call('GET', '/api/state');
  assert.equal(r.data.ipo, null);

  r = await call('POST', '/api/applications', { pan: 1, category: 1, shares: 10 });
  assert.equal(r.status, 400, 'application before IPO setup is rejected');

  r = await call('POST', '/api/setup', { totalShares: 1000, lotSize: 10, quotas: [30, 270, 200, 400] });
  assert.equal(r.status, 400, 'quotas must add up to total');

  r = await call('POST', '/api/setup', { totalShares: 1000, lotSize: 10, quotas: [30, 270, 200, 500] });
  assert.equal(r.status, 201);

  r = await call('POST', '/api/applications', { pan: 100001, category: 1, shares: 15 });
  assert.equal(r.status, 400, 'retail must be a multiple of the lot size');
  assert.match(r.data.error, /multiples of 10/);

  const apps = [
    [100001, 1, 10], [100002, 1, 10], [100003, 1, 20], [100004, 1, 10],
    [100005, 1, 30], [100006, 1, 10], [100007, 1, 20], [100008, 1, 10],
    [200001, 2, 100], [200002, 2, 150], [200003, 2, 210],
    [300001, 3, 80], [300002, 3, 100],
    [400001, 4, 300], [400002, 4, 400], [400003, 4, 500],
  ];
  for (const [pan, category, shares] of apps) {
    r = await call('POST', '/api/applications', { pan, category, shares });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }

  r = await call('POST', '/api/applications', { pan: 100001, category: 2, shares: 5 });
  assert.equal(r.status, 409, 'duplicate PAN is rejected by the hash table');

  r = await call('POST', '/api/applications', { pan: 'abc', category: 2, shares: 5 });
  assert.equal(r.status, 400, 'non numeric input never reaches the C program');

  r = await call('GET', '/api/applications');
  assert.equal(r.data.applications.length, 16);
  assert.deepEqual(r.data.applications[0], { appNo: 1, pan: 100001, category: 'Retail', shares: 10 });

  r = await call('GET', '/api/search?appNo=11');
  assert.equal(r.status, 200);
  assert.equal(r.data.application.pan, 200003);
  assert.equal(r.data.application.category, 'sNII');

  r = await call('GET', '/api/search?appNo=999');
  assert.equal(r.status, 404);

  r = await call('GET', '/api/results');
  assert.equal(r.status, 400, 'results need an allotment run first');

  r = await call('POST', '/api/allot');
  assert.equal(r.status, 200);
  assert.equal(r.data.results.length, 16);
  const sum = Object.fromEntries(r.data.summary.map((c) => [c.category, c]));
  assert.equal(sum.Retail.allotted, 30, 'retail lottery gives 3 lots of 10');
  assert.equal(sum.sNII.allotted, 270, 'sNII fills its quota exactly');
  assert.equal(sum.bNII.allotted, 180, 'bNII demand fits its quota');
  assert.equal(sum.QIB.allotted, 500, 'QIB fills its quota exactly');
  const qib = r.data.results.filter((x) => x.category === 'QIB').map((x) => x.allotted);
  assert.deepEqual(qib, [125, 167, 208], 'max-heap gives the leftover share to the largest remainder');

  r = await call('GET', '/api/results');
  assert.equal(r.status, 200);

  r = await call('GET', '/api/state');
  assert.equal(r.data.applicationCount, 16);
  assert.equal(r.data.allotted, true);

  r = await call('POST', '/api/reset');
  assert.equal(r.status, 200);
  r = await call('GET', '/api/state');
  assert.equal(r.data.ipo, null);
  assert.equal(r.data.applicationCount, 0);
});

test('sessions are isolated and the session header is required', async () => {
  let r = await call('GET', '/api/state', null, '');
  assert.equal(r.status, 400);

  await call('POST', '/api/setup', { totalShares: 100, lotSize: 5, quotas: [10, 20, 30, 40] }, 'isolated-session-a');
  r = await call('GET', '/api/state', null, 'isolated-session-b');
  assert.equal(r.data.ipo, null);
});
