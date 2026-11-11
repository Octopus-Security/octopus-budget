'use strict';
/**
 * No native alert()/confirm()/prompt() in client code: every dialog is the
 * themed octopus-kit one (oDialog.*), so the theme is fully controlled.
 * Also covers the /_kit/ route that serves the kit's dialog files.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const NATIVE = /(^|[^A-Za-z0-9_$.])(window\.)?(alert|confirm|prompt)\s*\(/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ejs|html|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('client code uses no native alert/confirm/prompt', () => {
  const hits = [];
  for (const f of [...walk(path.join(root, 'views')), ...walk(path.join(root, 'public'))]) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (NATIVE.test(line) || /\bwindow\.(alert|confirm|prompt)\b/.test(line)) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(hits, []);
});

test('the kit dialog files are served with JS/CSS types', { skip: !fs.existsSync(path.join(__dirname, '..', 'kitDialog.js')) }, () => {
  const { DIR } = require('../kitDialog');
  if (!fs.existsSync(path.join(DIR, 'dialog.js'))) return; // kit not installed on this machine
  const r = spawnSync(process.execPath, ['-e', `
    const express = require('express'); const { mountKitDialog } = require('./kitDialog');
    const app = express(); mountKitDialog(app);
    const s = app.listen(0, async () => {
      const b = 'http://127.0.0.1:' + s.address().port;
      const out = {};
      for (const f of ['dialog.js', 'dialog.css', 'nope.js']) { const r = await fetch(b + '/_kit/' + f); out[f] = [r.status, r.headers.get('content-type')]; }
      console.log(JSON.stringify(out)); s.close();
    });`], { cwd: root, encoding: 'utf8', env: process.env });
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out['dialog.js'][0], 200);
  assert.match(out['dialog.js'][1], /javascript/);
  assert.strictEqual(out['dialog.css'][0], 200);
  assert.match(out['dialog.css'][1], /css/);
  assert.strictEqual(out['nope.js'][0], 404);
});
