'use strict';

/**
 * layout.js — the pure merge/order/validate logic behind the customizable
 * dashboard. No database: see layout-store.test.js for the persistence side.
 *
 * Run: node --test test/layout.test.js
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const L        = require('../layout');

const keys = items => items.map(i => i.key);

// ── Sections ────────────────────────────────────────────────────────────────

test('defaults with no prefs: registry order, default titles, nothing hidden', () => {
  const s = L.resolveSections([], []);
  assert.deepEqual(keys(s),
    ['subscriptions', 'debts', 'installments', 'accounts', 'income', 'credit_scores', 'transactions']);
  assert.ok(s.every(x => !x.hidden && !x.customTitle && x.title === x.defaultTitle));
  assert.deepEqual(s.map(x => x.position), [0, 1, 2, 3, 4, 5, 6]);
});

test('prefs override title, order and hidden', () => {
  const s = L.resolveSections([
    { key: 'debts', title: 'Cards', position: 0, hidden: false },
    { key: 'subscriptions', title: null, position: 1, hidden: true },
  ], []);
  assert.deepEqual(keys(s).slice(0, 2), ['debts', 'subscriptions']);
  assert.strictEqual(s[0].title, 'Cards');
  assert.strictEqual(s[0].customTitle, true);
  assert.strictEqual(s[0].defaultTitle, 'Debts');
  assert.strictEqual(s[1].title, 'Subscriptions'); // null title falls back to default
  assert.strictEqual(s[1].hidden, true);
});

test('prefs for unknown section keys are ignored', () => {
  const s = L.resolveSections([{ key: 'bogus', title: 'X', position: 0, hidden: true }], []);
  assert.strictEqual(s.length, 7);
  assert.ok(!keys(s).includes('bogus'));
  assert.strictEqual(s[0].key, 'subscriptions');
});

test('a built-in with no pref still appears, after the ones that have a saved position', () => {
  // Simulates a release that added a section after the user saved a layout:
  // only some built-ins have prefs.
  const s = L.resolveSections([
    { key: 'income', position: 0 }, { key: 'accounts', position: 1 },
  ], []);
  assert.deepEqual(keys(s).slice(0, 2), ['income', 'accounts']);
  assert.strictEqual(s.length, 7);
  assert.deepEqual(keys(s).slice(2),
    ['subscriptions', 'debts', 'installments', 'credit_scores', 'transactions']);
});

test('custom sections are merged in by position', () => {
  const s = L.resolveSections(
    SECTION_PREFS_ALL(), [{ id: 4, title: 'Pets', position: 2, hidden: false }]);
  assert.strictEqual(s[2].key, 'custom:4');
  assert.strictEqual(s[2].builtin, false);
  assert.strictEqual(s[2].id, 4);
});
function SECTION_PREFS_ALL() {
  return L.SECTIONS.map((x, i) => ({ key: x.key, position: i < 2 ? i : i + 1 }));
}

// ── Moving ──────────────────────────────────────────────────────────────────

test('move up/down swaps neighbours and renormalises positions', () => {
  const s = L.resolveSections([], []);
  const down = L.moveItem(s, 'subscriptions', +1);
  assert.deepEqual(keys(down).slice(0, 2), ['debts', 'subscriptions']);
  assert.deepEqual(down.map(x => x.position), [0, 1, 2, 3, 4, 5, 6]);
  const up = L.moveItem(down, 'subscriptions', -1);
  assert.deepEqual(keys(up), keys(s));
});

test('move at the edges is a no-op, and an unknown key changes nothing', () => {
  const s = L.resolveSections([], []);
  assert.deepEqual(keys(L.moveItem(s, 'subscriptions', -1)), keys(s));
  assert.deepEqual(keys(L.moveItem(s, 'transactions', +1)), keys(s));
  assert.deepEqual(keys(L.moveItem(s, 'nope', +1)), keys(s));
  assert.deepEqual(L.moveItem(s, 'subscriptions', -1).map(x => x.position), [0, 1, 2, 3, 4, 5, 6]);
});

test('moveItem does not mutate its input', () => {
  const s = L.resolveSections([], []);
  const before = JSON.stringify(s);
  L.moveItem(s, 'debts', -1);
  assert.strictEqual(JSON.stringify(s), before);
});

test('orderItems repairs gaps and duplicate positions', () => {
  const out = L.orderItems([
    { key: 'a', position: 10, seq: 0 }, { key: 'b', position: 10, seq: 1 }, { key: 'c', position: 3, seq: 2 },
  ]);
  assert.deepEqual(keys(out), ['c', 'a', 'b']);
  assert.deepEqual(out.map(x => x.position), [0, 1, 2]);
});

// ── Columns ─────────────────────────────────────────────────────────────────

test('built-in columns default to the registry, and prefs rename/reorder/hide them', () => {
  const plain = L.resolveColumns('debts', []);
  assert.deepEqual(keys(plain), ['name', 'balance', 'credit_limit', 'available']);
  assert.ok(plain.every(c => c.builtin));

  const c = L.resolveColumns('debts', [
    { id: 1, section_key: 'debts', builtin_key: 'balance', label: 'Owed', position: 0, hidden: false },
    { id: 2, section_key: 'debts', builtin_key: 'name', label: 'Name', position: 1, hidden: true },
    { id: 3, section_key: 'subscriptions', builtin_key: 'name', label: 'Other section', position: 0 },
    { id: 4, section_key: 'debts', builtin_key: 'ghost', label: 'Unknown', position: 0 },
  ]);
  assert.strictEqual(c[0].key, 'balance');
  assert.strictEqual(c[0].label, 'Owed');
  assert.strictEqual(c[1].key, 'name');
  assert.strictEqual(c[1].hidden, true);
  assert.ok(!keys(c).includes('ghost'), 'unknown builtin_key ignored');
  assert.strictEqual(c.length, 4);
});

test('custom columns come after built-ins by default and use c:<id> keys', () => {
  const c = L.resolveColumns('accounts', [
    { id: 9, section_key: 'accounts', builtin_key: null, label: 'Bank', type: 'text', position: null },
  ]);
  assert.deepEqual(keys(c), ['name', 'balance', 'c:9']);
  assert.strictEqual(c[2].builtin, false);
  assert.strictEqual(c[2].type, 'text');
});

test('custom sections have only custom columns; credit_scores has none', () => {
  const c = L.resolveColumns('custom:2', [
    { id: 1, section_key: 'custom:2', builtin_key: null, label: 'Name', type: 'text', position: 0 },
    { id: 2, section_key: 'custom:2', builtin_key: null, label: 'Amount', type: 'money', position: 1 },
  ]);
  assert.deepEqual(keys(c), ['c:1', 'c:2']);
  assert.deepEqual(L.resolveColumns('credit_scores', []), []);
});

// ── Tiles ───────────────────────────────────────────────────────────────────

test('tile defaults: five visible in the current order, netWorth and bnplUsed hidden', () => {
  const t = L.resolveTiles([], new Map());
  assert.deepEqual(keys(t),
    ['totalDebt', 'monthlyIncome', 'totalAccounts', 'subscriptionTotal', 'monthlySpend', 'netWorth', 'bnplUsed']);
  assert.deepEqual(t.filter(x => !x.hidden).map(x => x.key),
    ['totalDebt', 'monthlyIncome', 'totalAccounts', 'subscriptionTotal', 'monthlySpend']);
});

test('a tile pref can reveal a default-hidden tile; unknown tile keys are ignored', () => {
  const t = L.resolveTiles([
    { key: 'netWorth', hidden: false, position: 0 },
    { key: 'nonsense', hidden: false, position: 0 },
  ], new Map());
  assert.strictEqual(t[0].key, 'netWorth');
  assert.strictEqual(t[0].hidden, false);
  assert.ok(!keys(t).includes('nonsense'));
});

test('custom tiles resolve against their column; orphans are dropped', () => {
  const cols = new Map([[5, { id: 5, label: 'Tips', type: 'money' }]]);
  const t = L.resolveTiles([
    { id: 1, key: null, title: 'My tips', column_id: 5, position: 99 },
    { id: 2, key: null, title: 'Gone', column_id: 77, position: 100 },
  ], cols);
  const custom = t.filter(x => !x.builtin);
  assert.strictEqual(custom.length, 1);
  assert.strictEqual(custom[0].key, 't:1');
  assert.strictEqual(custom[0].title, 'My tips');
  assert.strictEqual(custom[0].column_type, 'money');
});

test('sumValues ignores blanks and non-numeric values', () => {
  assert.strictEqual(L.sumValues(['1.5', '2', null, undefined, '', '  ', 'abc', '3x', '-0.5', '1e3', 'NaN', 'Infinity']), 3);
  assert.strictEqual(L.sumValues([]), 0);
  assert.strictEqual(L.sumValues(undefined), 0);
});

test('tileValue: built-in reads the metric; custom sums its column', () => {
  const metrics = { totalDebt: 12.5 };
  assert.strictEqual(L.tileValue({ builtin: true, key: 'totalDebt' }, metrics).text, '$12.50');
  assert.strictEqual(L.tileValue({ builtin: true, key: 'netWorth' }, metrics).text, '$0.00');
  const tile = { builtin: false, column_id: 3, column_type: 'money' };
  assert.strictEqual(L.tileValue(tile, null, { 3: ['10', 'x', '5.25', null] }).text, '$15.25');
  assert.strictEqual(L.tileValue({ ...tile, column_type: 'number' }, null, { 3: ['10', '5.255'] }).text, '15.26');
});

// ── Validation ──────────────────────────────────────────────────────────────

test('cleanLabel trims, caps at 60 and rejects blanks / non-strings', () => {
  assert.strictEqual(L.cleanLabel('  Hi  '), 'Hi');
  assert.strictEqual(L.cleanLabel('x'.repeat(100)).length, 60);
  assert.strictEqual(L.cleanLabel('   '), null);
  assert.strictEqual(L.cleanLabel(5), null);
  assert.strictEqual(L.cleanLabel(null), null);
});

test('parseCellValue type-checks each column type', () => {
  assert.deepEqual(L.parseCellValue('money', '$1,234.50'), { ok: true, value: '1234.5' });
  assert.deepEqual(L.parseCellValue('number', '-3'), { ok: true, value: '-3' });
  assert.strictEqual(L.parseCellValue('number', 'abc').ok, false);
  assert.strictEqual(L.parseCellValue('money', '1e9999').ok, false);
  assert.strictEqual(L.parseCellValue('money', '1.2.3').ok, false);
  assert.deepEqual(L.parseCellValue('date', '2026-02-28'), { ok: true, value: '2026-02-28' });
  assert.strictEqual(L.parseCellValue('date', '2026-02-30').ok, false);
  assert.strictEqual(L.parseCellValue('date', 'tomorrow').ok, false);
  assert.strictEqual(L.parseCellValue('text', 'x'.repeat(201)).ok, false);
  assert.strictEqual(L.parseCellValue('text', 'x'.repeat(200)).ok, true);
  assert.deepEqual(L.parseCellValue('money', ''), { ok: true, value: null });
  assert.deepEqual(L.parseCellValue('text', null), { ok: true, value: null });
  assert.strictEqual(L.parseCellValue('text', { a: 1 }).ok, false);
  assert.strictEqual(L.parseCellValue('weird', 'x').ok, false);
});

test('key helpers parse only well-formed keys', () => {
  assert.strictEqual(L.parseCustomSectionKey('custom:12'), 12);
  assert.strictEqual(L.parseCustomSectionKey('custom:12; drop'), null);
  assert.strictEqual(L.parseCustomColumnKey('c:7'), 7);
  assert.strictEqual(L.parseCustomColumnKey('name'), null);
  assert.strictEqual(L.parseCustomTileKey('t:3'), 3);
  assert.strictEqual(L.isTableSection('credit_scores'), false);
  assert.strictEqual(L.isTableSection('debts'), true);
});
