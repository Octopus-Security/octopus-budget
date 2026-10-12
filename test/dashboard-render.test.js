'use strict';

/**
 * Renders the REAL index.ejs (with its partials) against a throwaway database
 * and checks the output. ejs is not installed in a bare checkout, so the file
 * skips itself there rather than failing — in the image, or with the usual
 * borrowed NODE_PATH, it runs.
 *
 * Run: node --test test/dashboard-render.test.js
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

let ejs = null;
try { ejs = require('ejs'); } catch { /* not installed here */ }
const skip = ejs ? false : 'ejs is not installed on this machine';

const getDatabase = require('../database');
const S = require('../layout-store');
const { asset } = require('../build');

const root = path.join(__dirname, '..');
const username = `rendertest_${process.pid}`;
let db, storage;

before(async () => {
  if (!ejs) return;
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  db = getDatabase(username);
  storage = db.sequelize.options.storage;
  await db.sequelize.sync({ alter: true });
});
after(async () => {
  if (!db) return;
  await db.sequelize.close();
  for (const f of [storage, storage + '-journal']) { try { fs.unlinkSync(f); } catch { /* absent */ } }
});

async function render(extra = {}) {
  const [subscriptions, accounts, income, debts, installments, transactions] = await Promise.all([
    db.Subscription.findAll(), db.Account.findAll(), db.Income.findAll(), db.Debt.findAll(),
    db.Installment.findAll(), db.Transaction.findAll(),
  ]);
  const layout = await S.buildLayout(db, { totalDebt: 100, monthlyIncome: 200, totalAccounts: 300,
    subscriptionTotal: 10, monthlySpend: 5, netWorth: 50, bnplUsed: 7, subs: { monthlySpend: '1 transactions' } });
  return ejs.renderFile(path.join(root, 'views', 'index.ejs'), {
    asset, title: 'Budget Tracker', layout, subscriptions, accounts, income, debts, installments, transactions,
    providers: [{ id: 1, name: 'Affirm', allowance: 0, builtin: true, used: 0, icon_url: null, available: null, pct: null }],
    scores: {}, upcoming: [], monthlySpend: 5, user: { username: 'tester' }, ...extra,
  });
}

const count = (s, re) => (s.match(re) || []).length;

test('the dashboard renders with defaults: all sections, five tiles, balanced divs', { skip }, async () => {
  await db.Subscription.create({ name: 'Netflix', amount: 10, frequency: 'monthly' });
  await db.Debt.create({ name: 'Visa', amount: 100, balance: 100, credit_limit: 500 });
  await db.Installment.create({ name: 'PS5', provider: 'Affirm', total_amount: 100, payment_amount: 25,
    next_due_date: '2030-01-01', remaining_payments: 4, frequency: 'monthly' });
  await db.Transaction.create({ description: 'Lunch', amount: 12.5, date: '2026-10-01' });
  const html = await render();
  for (const k of ['subscriptions', 'debts', 'installments', 'accounts', 'income', 'credit_scores', 'transactions']) {
    assert.ok(html.includes(`data-section="${k}"`), `section ${k} missing`);
  }
  assert.strictEqual(count(html, /data-tile="/g), 5, 'only the five default tiles are visible');
  assert.ok(html.includes('$100.00'), 'tile value rendered');
  assert.ok(html.includes('Netflix') && html.includes('Visa') && html.includes('PS5') && html.includes('Lunch'));
  assert.ok(html.includes('"/scroll.js?v=') && html.includes('"/layout-edit.js?v='));
  assert.strictEqual(count(html, /<div\b/g), count(html, /<\/div>/g), 'unbalanced <div>');
});

test('hidden sections and columns disappear, renames and order apply', { skip }, async () => {
  await S.renameSection(db, 'debts', 'Cards');
  await S.hideSection(db, 'income', true);
  await S.hideColumn(db, 'subscriptions', 'frequency', true);
  await S.renameColumn(db, 'subscriptions', 'amount', 'Cost');
  await S.moveColumn(db, 'subscriptions', 'amount', -1);
  const html = await render();
  assert.ok(!html.includes('data-section="income"'), 'hidden section still rendered');
  assert.ok(html.includes('data-act="section-hide" data-key="income" data-hidden="0"'), 'no restore button');
  assert.ok(html.includes('>💳 Cards'), 'renamed section title');
  const table = html.slice(html.indexOf('data-section-table="subscriptions"'));
  const header = table.slice(0, table.indexOf('</tr>'));
  assert.ok(!header.includes('>Frequency<'), 'hidden column rendered');
  assert.ok(header.indexOf('>Cost<') < header.indexOf('>Name<'), 'column order not applied');
  assert.strictEqual(count(html, /<div\b/g), count(html, /<\/div>/g));
});

test('user-supplied text is escaped everywhere it is rendered', { skip }, async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const sec = await S.createCustomSection(db, evil);
  const row = await S.createCustomRow(db, sec.id);
  const cols = await S.loadColumns(db, sec.key);
  await S.renameColumn(db, sec.key, cols[0].key, evil);
  await S.setCellValue(db, cols[0].id, row.id, evil);
  await S.setCellValue(db, cols[1].id, row.id, '12.5');
  await S.createCustomTile(db, evil, cols[1].id);
  const html = await render();
  assert.ok(!html.includes('<img src=x'), 'raw user markup reached the page');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('$12.50'), 'money cell and custom tile formatted');
  assert.ok(html.includes('data-act="row-delete"') && html.includes('data-act="row-add"'));
  assert.strictEqual(count(html, /<div\b/g), count(html, /<\/div>/g));
});

test('a visible user column appears as an input on the built-in add form', { skip }, async () => {
  const r = await S.createCustomColumn(db, 'accounts', 'Branch', 'text');
  const html = await render();
  assert.ok(html.includes(`name="cv_${r.id}"`));
});

test('the fallback layout renders too', { skip }, async () => {
  const { fallbackLayout } = require('../layout');
  const html = await render({ layout: fallbackLayout({ totalDebt: 1, subs: {} }) });
  assert.ok(html.includes('data-section="subscriptions"'));
});
