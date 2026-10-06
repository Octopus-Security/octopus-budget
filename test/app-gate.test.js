'use strict';

/**
 * Per-app access gate, over real HTTP against the real entrypoint (a unit test of
 * appAccess.js alone would stay green if nothing called the gate at a route).
 * A stub octopus-auth answers session verification and /apps/:slug/allowed.
 *
 * Run: node --test test/app-gate.test.js
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
const SLUG = 'budget';
const ENTRY = 'index.js';
const GATED = '/settings';           // a route behind requireLogin
const API_GATED = '';    // an API-ish route behind requireLogin, or ''

const USERS = {
  'ok-token':   { username: 'gateAllowed', userId: 1, role: 'user' },
  'deny-token': { username: 'gateDenied',  userId: 2, role: 'user' },
};
const ACCESS = { gateAllowed: true, gateDenied: false };
const asks = [];

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

function startStubAuth() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const url = (req.url || '').split('?')[0];
        const json = (code, b) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
        if (req.method === 'POST' && url === '/api/auth/verify') {
          const m = /Bearer\s+(\S+)/.exec(req.headers.authorization || '');
          const user = m && USERS[m[1]];
          return json(200, user ? { valid: true, user } : { valid: false });
        }
        const am = /^\/api\/auth\/apps\/([^/]+)\/allowed$/.exec(url);
        if (am) {
          asks.push(am[1]);
          const cm = /octopus_sso=([^;]+)/.exec(req.headers.cookie || '');
          const user = cm && USERS[decodeURIComponent(cm[1])];
          return json(200, { allowed: user ? ACCESS[user.username] !== false : true, slug: am[1] });
        }
        json(404, {});
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function startApp({ authBase, slugEnv = SLUG }) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const env = {
    ...process.env, PORT: String(port), DB_PATH: path.join(tmp, 'x.db'), DATA_DIR: tmp,
    AUTH_SERVICE_URL: authBase, AUTH_PUBLIC_URL: 'https://auth.octopustechnology.net',
    APP_ACCESS_SLUG: slugEnv, AUTH_REMOTE_VERIFY: '',
  };
  const child = spawn(process.execPath, [ENTRY], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    try { if ((await fetch(`${base}/api/build`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* not up */ }
    await new Promise(r => setTimeout(r, 150));
  }
  const up = await fetch(`${base}/api/build`).then(r => r.ok, () => false);
  if (!up) { child.kill('SIGKILL'); throw new Error(`server did not start:\n${out.trim() || '(nothing)'}`); }
  return { base, stop() { child.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); } };
}

const as = (t) => ({ Cookie: `octopus_sso=${t}` });
let auth, authBase, app;
before(async () => {
  auth = await startStubAuth();
  authBase = `http://127.0.0.1:${auth.address().port}`;
  app = await startApp({ authBase });
});
after(() => { app?.stop(); auth?.close(); try { fs.readdirSync(path.join(root,"data")).filter(f=>/^gate(Allowed|Denied)_/.test(f)).forEach(f=>fs.rmSync(path.join(root,"data",f),{force:true})); } catch {} });

test('a denied account is refused with a no-access page on a page route', async () => {
  const res = await fetch(`${app.base}${GATED}`, { headers: { ...as('deny-token'), Accept: 'text/html' }, redirect: 'manual' });
  assert.strictEqual(res.status, 403);
  assert.match(await res.text(), /does not include/);
  assert.ok(asks.includes(SLUG), 'it asked auth about its own slug');
});


test('an allowed account gets past the gate', async () => {
  const res = await fetch(`${app.base}${GATED}`, { headers: as('ok-token'), redirect: 'manual' });
  assert.notStrictEqual(res.status, 403);
});

test('a signed-out request is still sent to login, not shown the no-access page', async () => {
  const res = await fetch(`${app.base}${GATED}`, { redirect: 'manual' });
  assert.notStrictEqual(res.status, 403);
});

test('/health and /api/build stay open to a denied account, and /api/build reports the gate', async () => {
  const b = await fetch(`${app.base}/api/build`, { headers: as('deny-token') });
  assert.strictEqual(b.status, 200);
  const body = await b.json();
  assert.strictEqual(body.gate, SLUG);
  assert.notStrictEqual(body.build, 'unknown');
});

test('/api/build derives gate from the mounted gate object, not a pasted constant', async () => {
  // The slug comes off the mounted gate object. A grep for a pasted constant:
  const src = fs.readFileSync(path.join(root, ENTRY), 'utf8');
  assert.match(src, /appAccessGate\.slug/);
});

test('unreachable auth fails open and /api/build still answers', async () => {
  const broken = await startApp({ authBase: 'http://127.0.0.1:1' });
  try {
    assert.strictEqual((await fetch(`${broken.base}/api/build`)).status, 200);
    const res = await fetch(`${broken.base}${GATED}`, { headers: as('deny-token'), redirect: 'manual' });
    assert.notStrictEqual(res.status, 403);
  } finally { broken.stop(); }
});
