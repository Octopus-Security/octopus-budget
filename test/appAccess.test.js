'use strict';

/**
 * The app-access gate. Run: node --test test/appAccess.test.js
 *
 * The one that matters is "denied is denied on a page too": a gate that only
 * answered API calls would leave the SPA shell open to a lapsed customer.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { createAppGate } = require('../appAccess');

function req(over = {}) {
  const headers = { cookie: 'octopus_sso=abc', ...(over.headers || {}) };
  return { user: { username: 'sam' }, originalUrl: '/', get: n => headers[n.toLowerCase()], ...over };
}
function res() {
  const r = { code: 200, body: undefined, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; }, type() { return r; }, status(c) { r.code = c; return r; } };
  return r;
}
const answer = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
async function run(gate, rq = req()) {
  const rs = res(); let nexted = false, err;
  await gate(rq, rs, e => { nexted = true; err = e; });
  return { rs, nexted, err };
}
const make = (fetchImpl, extra = {}) => createAppGate({ authUrl: 'http://auth', slug: 'budget', fetchImpl, ...extra });

test('allowed passes through', async () => {
  assert.strictEqual((await run(make(answer(200, { allowed: true })))).nexted, true);
});

test('denied is a 403 JSON for the API and carries the upgrade link', async () => {
  const { rs, nexted } = await run(make(answer(200, { allowed: false }), { upgradeUrl: 'https://x.test/learn' }), req({ originalUrl: '/api/me' }));
  assert.strictEqual(nexted, false);
  assert.strictEqual(rs.code, 403);
  assert.strictEqual(rs.body.code, 'no_access');
  assert.strictEqual(rs.body.upgradeUrl, 'https://x.test/learn');
});

test('denied is denied on a page too, not only on the API', async () => {
  const { rs, nexted } = await run(make(answer(200, { allowed: false })), req({ originalUrl: '/lesson/3' }));
  assert.strictEqual(nexted, false);
  assert.strictEqual(rs.code, 403);
  assert.match(String(rs.body), /No access/);
});

test('the upgrade link is escaped into the page', async () => {
  const { rs } = await run(make(answer(200, { allowed: false }), { upgradeUrl: 'https://x.test/?a="><script>' }));
  assert.ok(!String(rs.body).includes('<script>'));
});

test('it forwards the caller\'s credential and asks about its own slug', async () => {
  let seen;
  const f = async (url, opts) => { seen = { url, opts }; return { status: 200, ok: true, json: async () => ({ allowed: true }) }; };
  await run(make(f));
  assert.strictEqual(seen.url, 'http://auth/api/auth/apps/budget/allowed');
  assert.strictEqual(seen.opts.headers.Cookie, 'octopus_sso=abc');
});

test('the answer is cached, and a revocation lands after the TTL', async () => {
  let t = 1000, calls = 0, allowed = true;
  const f = async () => { calls++; return { status: 200, ok: true, json: async () => ({ allowed }) }; };
  const gate = make(f, { now: () => t });
  assert.strictEqual((await run(gate)).nexted, true);
  allowed = false;
  assert.strictEqual((await run(gate)).nexted, true, 'still cached');
  assert.strictEqual(calls, 1);
  t += 61 * 1000;
  assert.strictEqual((await run(gate)).nexted, false, 'revocation lands after the TTL');
});

test('an unreachable auth uses the last answer, and fails open with none', async () => {
  let t = 0, up = true;
  const f = async () => { if (!up) throw new Error('ECONNREFUSED'); return { status: 200, ok: true, json: async () => ({ allowed: false }) }; };
  const gate = make(f, { now: () => t });
  assert.strictEqual((await run(gate)).nexted, false);
  up = false; t += 120 * 1000;
  assert.strictEqual((await run(gate)).nexted, false, 'stale DENIED must stay denied through an outage');
  assert.strictEqual((await run(gate, req({ user: { username: 'new' } }))).nexted, true, 'no previous answer ⇒ open');
});

test('a 404 (slug unknown to auth) allows, because it is a config error and not a denial', async () => {
  assert.strictEqual((await run(make(answer(404, {})))).nexted, true);
});

test('a non-2xx other than 404 is an outage, not a denial', async () => {
  assert.strictEqual((await run(make(answer(500, {})))).nexted, true);
});

test('an empty slug disables the gate', async () => {
  let called = false;
  const gate = createAppGate({ authUrl: 'http://auth', slug: '', fetchImpl: async () => { called = true; } });
  assert.strictEqual((await run(gate)).nexted, true);
  assert.strictEqual(called, false);
});
