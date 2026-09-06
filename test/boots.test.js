'use strict';

/**
 * The app can actually be loaded.
 *
 * This exists because it already happened, on 2026-09-06, to this service and
 * to its neighbour, from one line of a cache-busting change:
 *
 *     app.set('views', …);
 *     app.locals.asset = asset;          // ← here
 *     …
 *     const { BUILD, STARTED_AT, asset } = require('./build');   // ← declared here
 *
 * `const` is hoisted but not initialised, so reading it earlier throws
 * "Cannot access 'asset' before initialization" — at MODULE LOAD, not on a
 * request. The result is not a broken page. It is a container that never
 * starts, and behind a proxy that is a 502 on every route at once.
 *
 * Every other test in this repo passed. All of them import the pieces —
 * helpers, routers, pure functions — and none of them loaded index.js, so a
 * green suite sat beside a service that could not boot. That is the estate's own
 * rule turned back on it: assert at the thing that is used, not at the parts
 * that work.
 *
 * Deliberately a SUBPROCESS. Requiring index.js in-process would bind a port,
 * open the database and leave a listener behind for the rest of the run; and a
 * throw during load is exactly what is being detected, so it must not take the
 * test runner with it.
 *
 * Run: node --test test/boots.test.js
 */

const { test }        = require('node:test');
const assert          = require('node:assert');
const path            = require('node:path');
const { spawnSync }   = require('node:child_process');

const root = path.join(__dirname, '..');

test('index.js loads without throwing', () => {
  const r = spawnSync(process.execPath, ['-e', `
    // Nothing must reach a real network or a real port.
    process.env.PORT = '0';
    require('./index.js');
    console.log('LOADED');
    process.exit(0);
  `], { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, PORT: '0' } });

  const output = `${r.stdout || ''}${r.stderr || ''}`;
  assert.ok(!/before initialization/.test(output),
    'index.js reads a const before it is declared — the container will not start, ' +
    `and every route 502s:\n${output.slice(0, 600)}`);
  assert.match(output, /LOADED/, `index.js did not load:\n${output.slice(0, 600)}`);
  assert.strictEqual(r.status, 0, `index.js exited ${r.status}:\n${output.slice(0, 600)}`);
});

/**
 * The same bug, caught statically and by name.
 *
 * The boot test above is the real one — it fails the way production failed. This
 * is the cheap companion that says WHY in one line instead of a stack trace, and
 * it also catches the ordering being reintroduced in a file that happens to load
 * for some other reason.
 */
test('app.locals.asset is assigned after the const that declares asset', () => {
  const fs  = require('node:fs');
  const src = fs.readFileSync(path.join(root, 'index.js'), 'utf8');

  const declared = src.search(/const \{[^}]*\basset\b[^}]*\} = require\('\.\/build'\)/);
  const assigned = src.indexOf('app.locals.asset');

  assert.ok(declared > 0, 'asset is no longer destructured from ./build');
  assert.ok(assigned > 0, 'app.locals.asset is not assigned — every template will throw at render');
  assert.ok(declared < assigned,
    'app.locals.asset is assigned before the const that declares it. `const` is ' +
    'hoisted but not initialised, so this throws "Cannot access \'asset\' before ' +
    'initialization" at module load — not a broken page, a container that never ' +
    'starts and 502s on every route.');
});
