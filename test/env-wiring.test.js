'use strict';

/**
 * Every env var the code reads must actually be passed through in
 * docker-compose.yml.
 *
 * A Portainer stack variable interpolates into the compose FILE. It is not
 * injected into the container. So a name the compose never mentions is simply
 * absent at runtime no matter how confidently the Portainer UI shows it set —
 * and the app sees undefined and takes its "not configured" branch.
 *
 * This service already has a comment saying exactly that about INTERNAL_SECRET:
 * when it is missing, cortex's /purchase writes silently 403, which reads as a
 * cortex problem rather than a missing variable here. That is the failure this
 * catches, before it ships.
 *
 * Ported from octopus-shopper, where the same test exists because ADMIN_USERNAME
 * was read, never wired, and made 52 recipes invisible to their owner.
 *
 * Run: node --test test/env-wiring.test.js
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const fs       = require('node:fs');
const path     = require('node:path');

const root    = path.join(__dirname, '..');
const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');

/** Every process.env.X read anywhere in this app's own source. */
function readsEnv() {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'test'
          || e.name === 'data' || e.name === 'api') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  })(root);

  const names = new Set();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      names.add(m[1]);
    }
  }
  return names;
}

// Set by the runtime or by Docker itself, never by this compose file.
const AMBIENT = new Set(['NODE_ENV', 'PORT', 'HOME', 'PATH', 'TZ']);

test('the scan finds something — it has not silently stopped matching', () => {
  const names = readsEnv();
  assert.ok(names.size >= 4, `only found ${names.size} env reads, which suggests the scan broke`);
  assert.ok(names.has('INTERNAL_SECRET'), 'known variable missing from the scan');
});

test('every env var the code reads is passed through in docker-compose.yml', () => {
  const missing = [...readsEnv()]
    .filter(n => !AMBIENT.has(n))
    .filter(n => !new RegExp(`^\\s*-\\s*${n}=`, 'm').test(compose))
    .sort();

  assert.deepStrictEqual(missing, [],
    'read at runtime but never reaching the container — setting these in Portainer will look like it worked and do nothing');
});

// Named individually because each has a specific, quiet failure.
test('INTERNAL_SECRET is wired — without it cortex /purchase 403s silently', () => {
  assert.match(compose, /^\s*-\s*INTERNAL_SECRET=/m);
});

test('BUDGET_OWNER is wired — it decides whose budget internal writes land in', () => {
  assert.match(compose, /^\s*-\s*BUDGET_OWNER=/m);
});

test('JWT_SECRET keeps its empty default and never regains a working one', () => {
  // The 2026-08-18 incident: this line read
  // ${JWT_SECRET:-octopus-shared-secret-change-in-production}, a value published
  // in the then-public octopus-auth repo, so "retiring" the variable in Portainer
  // switched this service onto a public secret instead of switching it off.
  const line = compose.split('\n').find(l => /^\s*-\s*JWT_SECRET=/.test(l));
  assert.ok(line, 'JWT_SECRET line is gone — if that is deliberate, delete this test with it');
  assert.match(line, /\$\{JWT_SECRET:-\}\s*$/,
    'JWT_SECRET must default to EMPTY; a non-empty default is accepted as an HS256 signing key');
});
