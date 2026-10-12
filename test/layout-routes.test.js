'use strict';

/**
 * The /layout/... and /custom/... JSON routes, mounted on a small express app
 * with a stand-in for requireLogin (the real one calls octopus-auth) and a real
 * throwaway sqlite database. Checks request-shape validation and that the
 * ownership/type rules in layout-store are reachable through HTTP.
 *
 * Run: node --test test/layout-routes.test.js
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');

let express = null;
try { express = require('express'); } catch { /* not installed here */ }
const skip = express ? false : 'express is not installed on this machine';

const getDatabase = require('../database');
const registerLayoutRoutes = require('../layout-routes');

const username = `routetest_${process.pid}`;
let db, storage, server, base, signedIn = true;

before(async () => {
  if (!express) return;
  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
  db = getDatabase(username);
  storage = db.sequelize.options.storage;
  await db.sequelize.sync({ alter: true });

  const app = express();
  app.use(express.json());
  const requireLogin = (req, res, next) => {
    if (!signedIn) return res.status(302).end();
    req.user = { username }; next();
  };
  registerLayoutRoutes(app, requireLogin, getDatabase);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(r => server.close(r));
  if (db) await db.sequelize.close();
  for (const f of [storage, storage + '-journal']) { try { fs.unlinkSync(f); } catch { /* absent */ } }
});

const post = async (url, body) => {
  const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json };
};

test('routes require a login', { skip }, async () => {
  signedIn = false;
  assert.strictEqual((await post('/layout/sections', { title: 'x' })).status, 302);
  signedIn = true;
});

test('section lifecycle over HTTP, incl. seeded columns and refusing to delete built-ins', { skip }, async () => {
  const made = await post('/layout/sections', { title: 'Pets' });
  assert.strictEqual(made.status, 200);
  assert.match(made.json.key, /^custom:\d+$/);
  const cols = await db.ColumnPref.findAll({ where: { section_key: made.json.key }, order: [['position', 'ASC']] });
  assert.deepEqual(cols.map(c => [c.label, c.type]), [['Name', 'text'], ['Amount', 'money']]);

  assert.strictEqual((await post('/layout/sections/delete', { key: 'debts' })).status, 400);
  assert.strictEqual((await post('/layout/sections/move', { key: 'debts', dir: 5 })).status, 400);
  assert.strictEqual((await post('/layout/sections/hide', { key: 'debts', hidden: 'yes' })).status, 400);
  assert.strictEqual((await post('/layout/sections/rename', { key: 'nope', title: 'x' })).status, 404);
  assert.strictEqual((await post('/layout/sections/rename', { key: made.json.key, title: '' })).status, 400);
  assert.strictEqual((await post('/layout/sections/delete', { key: made.json.key })).status, 200);
});

test('cell writes: shape, type and ownership are enforced through the route', { skip }, async () => {
  const sec = (await post('/layout/sections', { title: 'Gear' })).json;
  const row = (await post('/custom/rows', { section_id: sec.id })).json;
  assert.ok(row.ok);
  const cols = await db.ColumnPref.findAll({ where: { section_key: sec.key }, order: [['position', 'ASC']] });
  const money = cols[1].id;

  assert.strictEqual((await post('/custom/values', { column_id: money, row_id: row.id, value: 'abc' })).status, 400);
  assert.strictEqual((await post('/custom/values', { column_id: money, row_id: 99999, value: '1' })).status, 404);
  assert.strictEqual((await post('/custom/values', { column_id: money })).status, 400);
  assert.strictEqual((await post('/custom/values', { column_id: 'x; drop', row_id: 1, value: '1' })).status, 400);
  assert.strictEqual((await post('/custom/values', { column_id: money, row_id: row.id, value: { a: 1 } })).status, 400);
  const ok = await post('/custom/values', { column_id: money, row_id: row.id, value: '12.5' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.value, '12.5');

  // tile summing the column reports its new text after an edit
  const tile = await post('/layout/tiles', { title: 'Gear $', column_id: money });
  assert.strictEqual(tile.status, 200);
  const again = await post('/custom/values', { column_id: money, row_id: row.id, value: '20' });
  assert.strictEqual(again.json.tiles[tile.json.key], '$20.00');

  const del = await post('/custom/rows/delete', { section_id: sec.id, row_id: row.id });
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.json.tiles[tile.json.key], '$0.00');
  assert.strictEqual((await post('/custom/rows/delete', { section_id: sec.id, row_id: row.id })).status, 404);
});

test('column routes: add, rename, hide built-in, delete only user columns', { skip }, async () => {
  const add = await post('/layout/columns', { section_key: 'accounts', label: 'Branch', type: 'text' });
  assert.strictEqual(add.status, 200);
  assert.strictEqual((await post('/layout/columns', { section_key: 'accounts', label: 'X', type: 'bogus' })).status, 400);
  assert.strictEqual((await post('/layout/columns', { section_key: 'credit_scores', label: 'X', type: 'text' })).status, 400);
  assert.strictEqual((await post('/layout/columns/rename', { section_key: 'accounts', key: 'balance', label: 'Funds' })).status, 200);
  assert.strictEqual((await post('/layout/columns/hide', { section_key: 'accounts', key: 'balance', hidden: true })).status, 200);
  assert.strictEqual((await post('/layout/columns/delete', { section_key: 'accounts', key: 'balance' })).status, 400);
  assert.strictEqual((await post('/layout/columns/delete', { section_key: 'accounts', key: add.json.key })).status, 200);
});
