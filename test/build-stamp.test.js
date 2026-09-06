'use strict';

/**
 * The deploy-verification stamp.
 *
 * Portainer polls and reports back to nobody, so "did my fix land" can only be
 * answered by looking for the fix's effect — which is no help when the change
 * is invisible from outside, and actively misleading when Cloudflare is still
 * serving a cached client.
 *
 * The property worth defending is that the stamp MOVES when the code moves. A
 * stamp that silently stops tracking is worse than none: it reports "nothing
 * changed" for a deploy that did, and it does so in the confident direction.
 *
 * Run: node --test test/build-stamp.test.js
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const fs       = require('node:fs');
const path     = require('node:path');

const root = path.join(__dirname, '..');
const { BUILD, sourceFiles } = require('../build');

test('the stamp is a real hash, not the failure value', () => {
  assert.match(BUILD, /^[0-9a-f]{12}$/);
  assert.notStrictEqual(BUILD, 'unknown');
});

test('editing deployed source moves the stamp', () => {
  const target = path.join(root, 'database.js');
  const original = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, Buffer.concat([original, Buffer.from('\n// build-stamp probe\n')]));
    delete require.cache[require.resolve('../build')];
    const { BUILD: moved } = require('../build');
    assert.notStrictEqual(moved, BUILD, 'editing database.js did not move the stamp');
  } finally {
    fs.writeFileSync(target, original);
    delete require.cache[require.resolve('../build')];
  }
});

test('editing a template moves it too — templates are deployed behaviour', () => {
  const views = path.join(root, 'views');
  const name = fs.readdirSync(views).find(f => f.endsWith('.ejs'));
  assert.ok(name, 'expected at least one .ejs template');
  const target = path.join(views, name);
  const original = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, Buffer.concat([original, Buffer.from('\n<!-- probe -->\n')]));
    delete require.cache[require.resolve('../build')];
    const { BUILD: moved } = require('../build');
    assert.notStrictEqual(moved, BUILD, `editing views/${name} did not move the stamp`);
  } finally {
    fs.writeFileSync(target, original);
    delete require.cache[require.resolve('../build')];
  }
});

// A hand-written file list stops covering the file you just added, and the
// failure is silent. These assert the walk finds things by discovery.
test('the walk covers the app and excludes dependencies and live data', () => {
  const files = sourceFiles();
  assert.ok(files.includes('index.js'), 'index.js is not covered by the stamp');
  assert.ok(files.some(f => f.startsWith('views/')), 'templates are not covered');
  assert.ok(!files.some(f => f.startsWith('node_modules')), 'node_modules must not be hashed');
  assert.ok(!files.some(f => f.startsWith('data/')), 'live data must not be hashed');
  // Every other build.js in the estate skips test/. A stamp meaning a slightly
  // different thing in one service is the kind of undocumented difference that
  // costs someone an afternoon — this one used to be the odd one out, and a
  // test-only commit moved it.
  assert.ok(!files.some(f => f.startsWith('test/')), 'tests must not move the stamp');
  assert.ok(!files.includes('package-lock.json'), 'the lockfile is deliberately excluded');
});
