'use strict';

/**
 * Signup exists ONLY on octopus-auth's own page (owner decision 2026-11-07).
 * Real entrypoint over real HTTP; the stub auth records every request so we can
 * prove POST /api/auth/register never reaches auth and creates nothing.
 *
 * Run: node --test test/no-app-signup.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const AUTH_PUBLIC = 'https://auth.example.test';
const seen = [];
let stub, child, base, out = '';

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

before(async () => {
  stub = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    req.resume();
    req.on('end', () => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); });
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nosignup-'));
  child = spawn(process.execPath, ['index.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DB_PATH: path.join(tmp, 'x.db'), DATA_DIR: tmp,
      AUTH_SERVICE_URL: `http://127.0.0.1:${stub.address().port}`, AUTH_PUBLIC_URL: AUTH_PUBLIC,
      AUTH_REMOTE_VERIFY: '' },
  });
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try { if ((await fetch(`${base}/api/build`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* not up */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`server did not start:\n${out.trim() || '(nothing)'}`);
});

after(() => { if (child) child.kill('SIGKILL'); if (stub) stub.close(); });

test('POST /api/auth/register creates nothing and never calls auth', async () => {
  seen.length = 0;
  const r = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'someone', password: 'Aa1!aaaaaaaaaa', email: 'a@b.test', inviteCode: 'x' }),
  });
  assert.strictEqual(r.status, 410);
  const body = await r.json();
  assert.strictEqual(body.success, false);
  assert.ok(body.error.includes(`${AUTH_PUBLIC}/register`), body.error);
  assert.deepStrictEqual(seen.filter(s => /register/.test(s)), [], 'register must not be proxied to auth');
});

test('GET /register still redirects to the auth signup page', async () => {
  const r = await fetch(`${base}/register`, { redirect: 'manual' });
  assert.strictEqual(r.status, 302);
  const loc = r.headers.get('location');
  assert.ok(loc.startsWith(`${AUTH_PUBLIC}/login?register=1`), loc);
});
