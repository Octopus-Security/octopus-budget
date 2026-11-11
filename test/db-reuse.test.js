'use strict';
// Per-user handle reuse, isolation between users, pragmas and indexes.
// Run: node --test test/db-reuse.test.js
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const getDatabase = require('../database');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const made = [];
const user = (n) => { made.push(n); return n; };

after(async () => {
  for (const n of made) {
    try { await getDatabase(n).sequelize.close(); } catch {}
    for (const sfx of ['', '-wal', '-shm']) { try { fs.unlinkSync(path.join(dataDir, `${n}_database.sqlite${sfx}`)); } catch {} }
  }
});

test('the same user gets the same instance back', () => {
  const u = user('perf_same');
  assert.strictEqual(getDatabase(u), getDatabase(u));
  assert.strictEqual(getDatabase(u).sequelize, getDatabase(u).sequelize);
});

test('different users never share an instance or a file; data does not cross', async () => {
  const a = user('perf_alice'), b = user('perf_bob');
  const da = getDatabase(a), db = getDatabase(b);
  assert.notStrictEqual(da.sequelize, db.sequelize);
  await da.sequelize.sync(); await db.sequelize.sync();
  await da.Account.create({ name: 'only-alice', balance: 1 });
  assert.strictEqual(await db.Account.count(), 0);
  assert.strictEqual(await getDatabase(a).Account.count(), 1);
});

test('unsafe usernames are still refused and never cached', () => {
  assert.throws(() => getDatabase('../evil'));
  assert.throws(() => getDatabase(''));
});

test('pragmas apply on every connection, including a transaction handle', async () => {
  const { sequelize } = getDatabase(user('perf_pragma'));
  const read = async (opts) => {
    const [[m]] = await sequelize.query('PRAGMA journal_mode', opts);
    const [[t]] = await sequelize.query('PRAGMA busy_timeout', opts);
    return [m.journal_mode, t.timeout];
  };
  assert.deepStrictEqual(await read(), ['wal', 5000]);
  const t = await sequelize.transaction();
  try { assert.deepStrictEqual(await read({ transaction: t }), ['wal', 5000]); } finally { await t.commit(); }
});

test('indexes exist after ensureIndexes, and running it twice is a no-op', async () => {
  const { sequelize } = getDatabase(user('perf_idx'));
  await sequelize.sync();
  await getDatabase.ensureIndexes(sequelize);
  await getDatabase.ensureIndexes(sequelize);
  const [rows] = await sequelize.query("SELECT name FROM sqlite_master WHERE type='index'");
  const names = rows.map(r => r.name);
  assert.ok(names.includes('idx_transactions_date'));
  assert.ok(names.includes('idx_installments_next_due_date'));
});

test('the cache is bounded', () => {
  for (let i = 0; i < getDatabase._MAX_OPEN + 20; i++) getDatabase(`perf_lru_${i}`);
  assert.ok(getDatabase._cacheSize() <= getDatabase._MAX_OPEN);
});
