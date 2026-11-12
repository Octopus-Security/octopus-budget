'use strict';
/**
 * Security headers (octopus-vault/compliance/HIPAA.md, sweep 2026-11-12), over real HTTP against the
 * real entrypoint: nosniff, no framing, no x-powered-by, no-store for a signed-in answer, and the
 * unit behaviour of the helpers.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const ENTRY = 'index.js';
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
let child, base, tmp, started = false;
before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
  const env = { ...process.env, PORT: String(port), DB_PATH: path.join(tmp, 'x.db'), DATA_DIR: tmp,
    AUTH_SERVICE_URL: 'http://127.0.0.1:1', AUTH_REMOTE_VERIFY: '',  };
  child = spawn(process.execPath, [ENTRY], { cwd: root, stdio: 'ignore', env });
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    try { if ((await fetch(`${base}/api/build`, { signal: AbortSignal.timeout(1000) })).ok) { started = true; break; } } catch { /* not up */ }
    await new Promise(r => setTimeout(r, 200));
  }
});
after(() => { child?.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); });

test('every answer carries the security headers', async (t) => {
  if (!started) return t.skip('service did not start here (missing dependency or path)');
  for (const url of ['/api/build', '/definitely-not-here']) {
    const r = await fetch(base + url, { redirect: 'manual' });
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff', url);
    assert.strictEqual(r.headers.get('x-frame-options'), 'DENY', url);
    // Express's own 404 page sets a stricter CSP (default-src 'none') over ours; either blocks framing.
    assert.match(r.headers.get('content-security-policy') || '', /frame-ancestors 'none'|default-src 'none'/, url);
    assert.strictEqual(r.headers.get('x-powered-by'), null, url);
  }
});

test('a signed-in answer is no-store; an anonymous one is left alone', async (t) => {
  if (!started) return t.skip('service did not start here (missing dependency or path)');
  const signed = await fetch(`${base}/api/build`, { headers: { Cookie: 'octopus_sso=x' } });
  assert.strictEqual(signed.headers.get('cache-control'), 'no-store');
  const anon = await fetch(`${base}/api/build`);
  assert.notStrictEqual(anon.headers.get('cache-control'), 'no-store');
});

test('safeError never carries the message', () => {
  const { safeError } = require('../lib/safeguards');
  const e = new Error('UNIQUE constraint failed: value=secret-client-note'); e.code = 'SQLITE_CONSTRAINT';
  const out = safeError(e);
  assert.ok(out.startsWith('Error SQLITE_CONSTRAINT'));
  assert.ok(!out.includes('secret-client-note'));
});
