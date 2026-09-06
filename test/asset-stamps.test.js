'use strict';

/**
 * Versioned asset URLs.
 *
 * Cloudflare caches CSS and JS for four hours and OVERRIDES the origin's
 * Cache-Control, so a shipped front-end fix is invisible for that long and looks
 * exactly like a deploy that failed. On 2026-09-05 a menu fix on the public site
 * was correct, deployed, verified in a browser, and still broken for the person
 * looking at it — cf-cache-status HIT, age 1332, last-modified in August.
 *
 * `/theme.css?v=<hash of that file>` is a different URL, so it is fetched fresh the
 * moment it is deployed. No purge, no API token, nothing to remember.
 *
 * Run: node --test test/asset-stamps.test.js
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const fs       = require('node:fs');
const os       = require('node:os');
const path     = require('node:path');

const root = path.join(__dirname, '..');
const { BUILD, asset } = require('../build');

/**
 * Append a probe, re-require build.js, read WHILE the probe is in place, then
 * restore. asset() is lazy and caches on first call, so reading after the
 * restore would re-hash the original file and compare a value to itself.
 */
function withProbe(relPath, read) {
  const target   = path.join(root, relPath);
  const original = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, Buffer.concat([original, Buffer.from('\n/* probe */\n')]));
    delete require.cache[require.resolve('../build')];
    return read(require('../build'));
  } finally {
    fs.writeFileSync(target, original);
    delete require.cache[require.resolve('../build')];
  }
}

test('the asset URL carries a content hash', () => {
  assert.match(asset('/theme.css'), /\?v=[0-9a-f]{8}$/);
});

test('the stamp moves when the file changes, and only then', () => {
  const moved = withProbe('public/theme.css', m => m.asset('/theme.css'));
  assert.notStrictEqual(moved, asset('/theme.css'), 'editing the asset did not move its stamp');

  // BUILD moves whenever any server file changes. If asset() used it, every
  // deploy would re-download every asset and throw away caching that is doing
  // its job.
  assert.strictEqual(withProbe('index.js', m => m.asset('/theme.css')), asset('/theme.css'),
    'editing the server moved the asset stamp — that re-downloads assets for no reason');
  assert.notStrictEqual(asset('/theme.css').split('=')[1], BUILD, 'the asset stamp is the build stamp');
});

test('a missing asset degrades to the bare path rather than throwing', () => {
  // A missing stamp is a stale cache. A thrown error is a blank page.
  assert.strictEqual(asset('/definitely-not-here.css'), '/definitely-not-here.css');
});

/**
 * The guard that matters most. Everything else can be right while one template
 * still links an unstamped URL — and that template is the one that goes stale,
 * silently, exactly as if the deploy had failed. Scanned rather than listed, so
 * a template added tomorrow is covered without anyone remembering.
 */
test('every CSS and JS reference in every view is stamped', () => {
  const views = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ejs')) views.push(full);
    }
  })(path.join(root, 'views'));
  assert.ok(views.length, 'no views found — this would pass vacuously');

  const unstamped = [];
  for (const file of views) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:href|src)="(\/[^"]*\.(?:css|js|mjs))"/g)) {
      unstamped.push(`${path.relative(root, file)} → ${m[1]}`);
    }
  }
  assert.deepEqual(unstamped, [],
    'these link an unversioned asset, so Cloudflare will keep serving the cached ' +
    "copy for four hours after a deploy — use <%= asset('/path') %>");
});

/**
 * A timestamp is not a content hash, and it is the wrong kind of wrong: it
 * changes on every RENDER, so the stylesheet is re-downloaded on every page
 * load and caching is thrown away entirely rather than merely being stale.
 */
test('no view busts the cache with a timestamp', () => {
  const offenders = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ejs')) {
        const src = fs.readFileSync(full, 'utf8');
        if (/\?v=<%=\s*Date\.now\(\)/.test(src)) offenders.push(path.relative(root, full));
      }
    }
  })(path.join(root, 'views'));
  assert.deepEqual(offenders, [],
    'Date.now() in an asset URL re-downloads the file on every request — use asset()');
});

/**
 * asset() has to actually reach the templates. app.locals is what makes that
 * true without every render remembering to pass it, so this drives express's
 * real render pipeline rather than asserting the assignment exists.
 */
test('app.locals.asset reaches a render, with nothing passed per-render', async () => {
  const express = require('express');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'views-'));
  try {
    fs.writeFileSync(path.join(dir, 'probe.ejs'), `<link href="<%= asset('/theme.css') %>">`);
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', dir);
    app.locals.asset = asset;

    const html = await new Promise((resolve, reject) =>
      app.render('probe', {}, (err, out) => (err ? reject(err) : resolve(out))));
    assert.match(html, /\?v=[0-9a-f]{8}"/, 'app.locals.asset did not reach the template');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the real login.ejs head renders with a stamped stylesheet', () => {
  const ejs  = require('ejs');
  const src  = fs.readFileSync(path.join(root, 'views', 'login.ejs'), 'utf8');
  const end  = src.indexOf('</head>');
  const head = end === -1 ? src : src.slice(0, end + 7);
  const out  = ejs.render(head, { asset, title: 'probe' });

  // Built from the same string the app uses, so the test cannot drift from it
  // by a typo in a hand-written pattern.
  const expected = new RegExp(
    '/theme.css'.replace(/[.*+?^${}()|[\]\\/]/g, ch => '\\' + ch) + '\\?v=[0-9a-f]{8}');
  assert.match(out, expected,
    'the real template did not come out with a versioned stylesheet');
});
