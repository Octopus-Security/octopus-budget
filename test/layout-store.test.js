'use strict';

/**
 * layout-store.js against a REAL throwaway sqlite file, opened through
 * getDatabase exactly as the app does (see isolation.test.js). The file is
 * deleted afterwards.
 *
 * The important group is row ownership: a cell may only be written against a
 * row that actually belongs to the column's section.
 *
 * Run: node --test test/layout-store.test.js
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

const getDatabase = require('../database');
const S           = require('../layout-store');
const L           = require('../layout');

const dataDir  = path.join(__dirname, '..', 'data');
const username = `layouttest_${process.pid}`;
let db, storage;

before(async () => {
  fs.mkdirSync(dataDir, { recursive: true });
  db = getDatabase(username);
  storage = db.sequelize.options.storage;
  await db.sequelize.sync({ alter: true });
});

after(async () => {
  if (db) await db.sequelize.close();
  for (const f of [storage, storage + '-journal']) { try { fs.unlinkSync(f); } catch { /* absent */ } }
});

async function userColumn(sectionKey, type = 'text', label = 'Note') {
  const r = await S.createCustomColumn(db, sectionKey, label, type);
  assert.ok(r.ok, JSON.stringify(r));
  return r.id;
}

test('a cell can be written for a row that exists in the column\'s built-in section', async () => {
  const sub = await db.Subscription.create({ name: 'Netflix', amount: 10, frequency: 'monthly' });
  const col = await userColumn('subscriptions');
  const r = await S.setCellValue(db, col, sub.id, 'family plan');
  assert.ok(r.ok);
  assert.strictEqual((await db.CustomValue.findOne({ where: { column_id: col, row_id: sub.id } })).value, 'family plan');
});

test('OWNERSHIP: a cell cannot be written against a row id that does not exist in the section', async () => {
  const col = await userColumn('subscriptions');
  const r = await S.setCellValue(db, col, 987654, 'x');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 404);
  assert.strictEqual(await db.CustomValue.count({ where: { column_id: col } }), 0);
});

test('OWNERSHIP: a row id from ANOTHER section is rejected (ids collide across tables)', async () => {
  // Same numeric id exists in accounts but not in subscriptions' own table.
  const acct = await db.Account.create({ name: 'Checking-own', balance: 5 });
  const subs = await db.Subscription.findAll();
  const maxSub = subs.reduce((m, s) => Math.max(m, s.id), 0);
  // Make sure we test an id valid for accounts and absent from subscriptions.
  let foreign = acct.id;
  if (subs.some(s => s.id === foreign)) {
    const filler = await db.Account.create({ name: 'Checking-own-2', balance: 1 });
    foreign = filler.id + maxSub + 1;
    await db.Account.create({ id: foreign, name: 'Checking-own-3', balance: 1 });
  }
  const col = await userColumn('subscriptions');
  const r = await S.setCellValue(db, col, foreign, 'leak');
  assert.strictEqual(r.ok, false, 'a subscriptions column accepted an accounts row');
  assert.strictEqual(r.status, 404);
});

test('OWNERSHIP: a custom-section column rejects a CustomRow of a different custom section', async () => {
  const a = await S.createCustomSection(db, 'A');
  const b = await S.createCustomSection(db, 'B');
  const rowB = await S.createCustomRow(db, b.id);
  const colsA = await S.loadColumns(db, a.key);
  const amountA = colsA[1].id;
  const bad = await S.setCellValue(db, amountA, rowB.id, '5');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.status, 404);

  const rowA = await S.createCustomRow(db, a.id);
  const good = await S.setCellValue(db, amountA, rowA.id, '5');
  assert.ok(good.ok);
});

test('rowBelongsToSection rejects non-integers, zero and unknown sections', async () => {
  assert.strictEqual(await S.rowBelongsToSection(db, 'subscriptions', 0), false);
  assert.strictEqual(await S.rowBelongsToSection(db, 'subscriptions', '1'), false);
  assert.strictEqual(await S.rowBelongsToSection(db, 'credit_scores', 1), false);
  assert.strictEqual(await S.rowBelongsToSection(db, 'custom:999999', 1), false);
});

test('values are type-checked, and built-in columns cannot hold values', async () => {
  const sub = await db.Subscription.create({ name: 'Hulu', amount: 8, frequency: 'monthly' });
  const money = await userColumn('subscriptions', 'money', 'Tip');
  assert.strictEqual((await S.setCellValue(db, money, sub.id, 'lots')).status, 400);
  assert.strictEqual((await S.setCellValue(db, 123456, sub.id, '1')).status, 404);
  const r = await S.setCellValue(db, money, sub.id, '$4.5');
  assert.strictEqual(r.value, '4.5');
  // blank clears
  await S.setCellValue(db, money, sub.id, '');
  assert.strictEqual(await db.CustomValue.count({ where: { column_id: money, row_id: sub.id } }), 0);
  // a ColumnPref row that records a built-in column is not writable
  const builtinPref = await db.ColumnPref.create({ section_key: 'subscriptions', builtin_key: 'name', label: 'Name', type: 'text', position: 0 });
  assert.strictEqual((await S.setCellValue(db, builtinPref.id, sub.id, 'x')).status, 404);
});

test('deleting a built-in row\'s values, a custom column, and a custom section cascade', async () => {
  const sub = await db.Subscription.create({ name: 'Spotify', amount: 11, frequency: 'monthly' });
  const col = await userColumn('subscriptions', 'money', 'Share');
  await S.setCellValue(db, col, sub.id, '3');
  const tile = await S.createCustomTile(db, 'Shares', col);
  assert.ok(tile.ok);

  await S.deleteRowValues(db, 'subscriptions', sub.id);
  assert.strictEqual(await db.CustomValue.count({ where: { column_id: col, row_id: sub.id } }), 0);

  await S.setCellValue(db, col, sub.id, '3');
  assert.ok((await S.deleteCustomColumn(db, 'subscriptions', L.customColumnKey(col))).ok);
  assert.strictEqual(await db.CustomValue.count({ where: { column_id: col } }), 0);
  assert.strictEqual(await db.TilePref.count({ where: { column_id: col } }), 0);

  const sec = await S.createCustomSection(db, 'Pets');
  const row = await S.createCustomRow(db, sec.id);
  const cols = await S.loadColumns(db, sec.key);
  await S.setCellValue(db, cols[1].id, row.id, '9');
  await S.createCustomTile(db, 'Pet money', cols[1].id);
  assert.ok((await S.deleteCustomSection(db, sec.key)).ok);
  assert.strictEqual(await db.CustomRow.count({ where: { section_id: sec.id } }), 0);
  assert.strictEqual(await db.ColumnPref.count({ where: { section_key: sec.key } }), 0);
  assert.strictEqual(await db.CustomValue.count({ where: { column_id: cols.map(c => c.id) } }), 0);
  assert.strictEqual(await db.TilePref.count({ where: { column_id: cols.map(c => c.id) } }), 0);
});

test('built-in sections and columns can only be hidden, never deleted', async () => {
  assert.strictEqual((await S.deleteCustomSection(db, 'debts')).status, 400);
  assert.strictEqual((await S.deleteCustomColumn(db, 'debts', 'name')).status, 400);
  assert.strictEqual((await S.deleteCustomTile(db, 'totalDebt')).status, 400);
  assert.ok((await S.hideSection(db, 'debts', true)).ok);
  assert.ok((await S.hideColumn(db, 'debts', 'name', true)).ok);
  assert.strictEqual((await S.loadSections(db)).find(s => s.key === 'debts').hidden, true);
  await S.hideSection(db, 'debts', false);
});

test('rename, move and positions persist; blank rename resets a built-in', async () => {
  assert.ok((await S.renameSection(db, 'accounts', 'Banks')).ok);
  assert.strictEqual((await S.loadSections(db)).find(s => s.key === 'accounts').title, 'Banks');
  assert.ok((await S.renameSection(db, 'accounts', '')).ok);
  assert.strictEqual((await S.loadSections(db)).find(s => s.key === 'accounts').title, 'Accounts');
  assert.strictEqual((await S.renameSection(db, 'accounts', 5)).status, 400);

  const before = (await S.loadSections(db)).map(s => s.key);
  await S.moveSection(db, before[1], -1);
  const after = (await S.loadSections(db)).map(s => s.key);
  assert.strictEqual(after[0], before[1]);
  assert.strictEqual(after[1], before[0]);
  assert.deepEqual((await S.loadSections(db)).map(s => s.position), after.map((_, i) => i));
});

test('a custom tile only accepts a number/money user column', async () => {
  const text = await userColumn('income', 'text', 'Memo');
  assert.strictEqual((await S.createCustomTile(db, 'x', text)).status, 400);
  assert.strictEqual((await S.createCustomTile(db, 'x', 424242)).status, 404);
  assert.strictEqual((await S.createCustomTile(db, 'x', 'abc')).status, 400);
});

test('credit_scores takes no columns', async () => {
  assert.strictEqual((await S.createCustomColumn(db, 'credit_scores', 'X', 'text')).status, 400);
  assert.strictEqual((await S.createCustomColumn(db, 'nope', 'X', 'text')).status, 404);
});

test('saveFormCustomValues stores only this section\'s valid cv_ fields', async () => {
  const sub = await db.Subscription.create({ name: 'Disney', amount: 9, frequency: 'monthly' });
  const mine  = await userColumn('subscriptions', 'number', 'Seats');
  const other = await userColumn('accounts', 'text', 'Branch');
  await S.saveFormCustomValues(db, 'subscriptions', sub.id, {
    name: 'x', [`cv_${mine}`]: '4', [`cv_${other}`]: 'leak', cv_999999: 'ghost',
  });
  assert.strictEqual(await db.CustomValue.count({ where: { row_id: sub.id } }), 1);
  assert.strictEqual((await db.CustomValue.findOne({ where: { column_id: mine, row_id: sub.id } })).value, '4');
});

test('buildLayout assembles sections, tiles, cells and custom rows', async () => {
  const sec = await S.createCustomSection(db, 'Gear');
  const row = await S.createCustomRow(db, sec.id);
  const cols = await S.loadColumns(db, sec.key);
  await S.setCellValue(db, cols[1].id, row.id, '12.5');
  await S.createCustomTile(db, 'Gear total', cols[1].id);
  const out = await S.buildLayout(db, { totalDebt: 1, subs: { monthlySpend: '2 transactions' } });
  const gear = out.sections.find(s => s.key === sec.key);
  assert.deepEqual(gear.columns.map(c => c.label), ['Name', 'Amount']);
  assert.strictEqual(out.cv[cols[1].id][row.id], '12.5');
  assert.deepEqual(out.customRows[sec.id].map(r => r.id), [row.id]);
  const tile = out.tiles.find(t => t.title === 'Gear total');
  assert.strictEqual(tile.text, '$12.50');
  assert.strictEqual(out.tiles.find(t => t.key === 'monthlySpend').sub, '2 transactions');
  assert.ok(out.sumColumns.some(c => c.id === cols[1].id));
});
