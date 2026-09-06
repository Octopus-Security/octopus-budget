"use strict";

/**
 * The service can actually be loaded.
 *
 * This exists because it already happened. On 2026-09-06 a cache-busting change
 * put `app.locals.asset = asset;` above the `const { … asset } =
 * require('./build')` that declares it. `const` is hoisted but not initialised,
 * so that throws "Cannot access 'asset' before initialization" at MODULE LOAD —
 * not a broken page, a container that never starts, which behind the proxy is a
 * 502 on every route at once. octopus-budget and octopus-shopper both went down
 * that way, with 22 and 102 green tests respectively.
 *
 * That is the point. Every test in those repos imported the PIECES — helpers,
 * routers, pure functions — and not one of them loaded the entrypoint, so a
 * green suite sat beside a service that could not boot. The estate's own rule,
 * turned back on it: assert at the thing that is used, not at the parts that
 * work.
 *
 * Deliberately a SUBPROCESS. Loading the entrypoint in-process would bind a
 * port, open a database and leave a listener behind for the rest of the run;
 * and a throw during load is exactly what is being detected, so it must not
 * take the runner with it.
 *
 * Run: node --test test/boots.test.js
 */

const { test }      = require('node:test');
const assert        = require('node:assert');
const path          = require('node:path');
const { spawnSync } = require('node:child_process');

const root  = path.join(__dirname, '..');
const ENTRY = 'index.js';

test('the entrypoint loads, or fails only for something this machine lacks', () => {
  const r = spawnSync(
    process.execPath,
    ['-e', "process.env.PORT='0'; require('./" + ENTRY + "'); console.log('LOADED'); process.exit(0);"],
    { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, PORT: '0' } },
  );

  const output = `${r.stdout || ''}${r.stderr || ''}`;
  const excerpt = output.slice(0, 700);

  // The failure this test was written for, named explicitly so the message says
  // what to do rather than making someone read a stack trace.
  assert.ok(!/before initialization/.test(output),
    `${ENTRY} reads a const before it is declared. The container will not start ` +
    `and every route 502s — move the assignment below the require:\n${excerpt}`);

  if (/LOADED/.test(output)) {
    assert.strictEqual(r.status, 0, `${ENTRY} loaded then exited ${r.status}:\n${excerpt}`);
    return;
  }

  // ── Two things that are the MACHINE's fault, not this repo's ───────────────
  //
  // Both are narrow on purpose. Widening either would turn this into a test
  // that passes whatever happens, which is worse than not having one.

  // 1. A dependency that is not installed here — npm install does not work on
  //    this laptop while the @octopus-security packages are private. A RELATIVE
  //    require that cannot resolve is NOT this: that is a file missing from the
  //    repo, and it falls through and fails.
  const missingDep = /Cannot find module '([^']+)'/.exec(output);
  if (missingDep && !missingDep[1].startsWith('.')) {
    console.log(`  (not loaded here: ${missingDep[1]} is not installed on this machine)`);
    return;
  }

  // 2. A path the container has and a checkout does not — octopus-claude wants
  //    to mkdir /workspace, a volume in production and root-owned here.
  //    Restricted to an ABSOLUTE path outside the repo, so a permission error
  //    on something the repo actually ships still fails.
  const fsDenied = /(?:EACCES|EPERM|EROFS|ENOENT)[^\n]*'(\/[^']*)'/.exec(output);
  if (fsDenied && !fsDenied[1].startsWith(root)) {
    console.log(`  (not loaded here: ${fsDenied[1]} exists in the container, not in a checkout)`);
    return;
  }

  assert.fail(`${ENTRY} failed to load, and not for anything this machine is missing:\n${excerpt}`);
});

/**
 * The same bug, caught statically and by name.
 *
 * The boot test above is the real one — it fails the way production failed.
 * This is the cheap companion that says WHY in one line instead of a stack
 * trace, and it catches the ordering being reintroduced even on a machine where
 * the entrypoint cannot load for other reasons.
 */
test('app.locals.asset is assigned after the const that declares asset', () => {
  const fs  = require('node:fs');
  const src = fs.readFileSync(path.join(root, ENTRY), 'utf8');

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
