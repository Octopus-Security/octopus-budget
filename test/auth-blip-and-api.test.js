'use strict';
// (1) an auth blip is never negative-cached; (2) Bearer /api routes create the
// user's tables first. Real entrypoint over HTTP with a stub octopus-auth.
// Run: node --test test/auth-blip-and-api.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const USER = 'apionly_perf';
const WEB = 'webuser_perf';
let mode = 'down';          // 'down' = 500, 'ok' = valid, 'reject' = 401
let verifyCalls = 0;
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
let auth, app, child;

before(async () => {
  auth = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const url = req.url.split('?')[0];
      const json = (c, b) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
      if (req.method === 'POST' && url === '/api/auth/verify') {
        verifyCalls++;
        if (mode === 'down') return json(500, {});
        if (mode === 'reject') return json(401, { valid: false });
        const bearer = /Bearer api-token/.test(req.headers.authorization || '');
        return json(200, { valid: true, user: { username: bearer ? USER : WEB, userId: 9, role: 'user' } });
      }
      if (/\/allowed$/.test(url)) return json(200, { allowed: true });
      json(404, {});
    });
  });
  await new Promise(r => auth.listen(0, '127.0.0.1', r));
  const port = await freePort();
  app = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['index.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), AUTH_SERVICE_URL: `http://127.0.0.1:${auth.address().port}`, AUTH_REMOTE_VERIFY: '1' },
  });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try { if ((await fetch(`${app}/api/build`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('did not start: ' + out);
});
after(() => {
  child?.kill('SIGKILL'); auth?.close();
  for (const u of [USER, WEB]) for (const sfx of ['', '-wal', '-shm']) { try { fs.unlinkSync(path.join(root, 'data', `${u}_database.sqlite${sfx}`)); } catch {} }
});

test('an auth outage (5xx) is not remembered: the next request asks again and succeeds', async () => {
  mode = 'down';
  const hdr = { Cookie: 'octopus_sso=blip-token' };
  await fetch(`${app}/settings`, { headers: hdr, redirect: 'manual' });
  const after1 = verifyCalls;
  mode = 'ok';
  const r = await fetch(`${app}/settings`, { headers: hdr, redirect: 'manual' });
  assert.ok(verifyCalls > after1, 'second request re-asked auth instead of using a cached failure');
  assert.notStrictEqual(r.status, 302, 'user was signed in once auth recovered');
});

test('a definite rejection (401) is cached briefly', async () => {
  mode = 'reject';
  const hdr = { Cookie: 'octopus_sso=bad-token' };
  await fetch(`${app}/settings`, { headers: hdr, redirect: 'manual' });
  const n = verifyCalls;
  await fetch(`${app}/settings`, { headers: hdr, redirect: 'manual' });
  assert.strictEqual(verifyCalls, n);
});

test('a Bearer-only user who never loaded a page gets a working /api response', async () => {
  mode = 'ok';
  const dbFile = path.join(root, 'data', `${USER}_database.sqlite`);
  assert.ok(!fs.existsSync(dbFile));
  const r = await fetch(`${app}/api/subscriptions`, { headers: { Authorization: 'Bearer api-token' } });
  assert.strictEqual(r.status, 200, await r.text());
  assert.ok(fs.existsSync(dbFile));
  const p = await fetch(`${app}/api/accounts`, { method: 'POST', headers: { Authorization: 'Bearer api-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'a', balance: 5 }) });
  assert.ok(p.status < 300, String(p.status));
});
