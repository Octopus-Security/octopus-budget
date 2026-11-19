'use strict';

/**
 * Every Delete and "✓ Paid" button on the dashboard goes through
 * public/confirm-actions.js, which calls window.oDialog.confirm(). oDialog
 * comes from octopus-kit's ui/dialog.js, served by kitDialog.js.
 *
 * The kit tag v0.6.0 points at the WRONG commit (77857e5, no ui/dialog.js;
 * vault HANDOFF item 114). Pinned to it, /_kit/dialog.js 404s, oDialog is
 * undefined, confirm-actions has already called preventDefault, and the click
 * does nothing at all: no dialog, no request, no error the owner can see.
 * Budget shipped like that from 2026-11-11 to 2026-11-19 because the nine
 * fix PRs for item 114 missed it.
 *
 * Run: node --test test/kit-dialog-pin.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('octopus-kit is not pinned to the broken v0.6.0 tag', () => {
  const spec = (pkg.dependencies || {})['octopus-kit'] || '';
  assert.ok(spec, 'octopus-kit is not a dependency, but kitDialog.js serves files from it');
  assert.ok(!/refs\/tags\/v0\.6\.0\b/.test(spec),
    'octopus-kit v0.6.0 has no ui/dialog.js; every confirm-gated button would silently do nothing');
});

test('every page that loads confirm-actions.js also loads the kit dialog', () => {
  const views = path.join(root, 'views');
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p); else if (p.endsWith('.ejs')) files.push(p);
    }
  })(views);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (src.includes('confirm-actions.js')) {
      assert.ok(src.includes('kitDialogHead'),
        `${path.relative(root, f)} loads confirm-actions.js without kitDialogHead, so oDialog is undefined there`);
    }
  }
});
