'use strict';
// Renders the real views against a real (temporary) per-user SQLite database.
const { test, after } = require('node:test');
const assert  = require('node:assert');
const fs      = require('node:fs');
const path    = require('node:path');
const express = require('express');
const getDatabase = require('../database');
const { register } = require('../planner/routes');
const { asset } = require('../build');
const D = require('../planner/dates');

const USER = `plannertest_${process.pid}`;
const dbFile = path.join(__dirname, '..', 'data', `${USER}_database.sqlite`);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.locals.asset = asset;
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => { req.user = { username: USER }; next(); });
register(app, { requireLogin: (req, res, next) => next(), getDatabase });

let server, base;
const post = (p, body) => fetch(base + p, { method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

test('income, check-in, bills and the plan work end to end', async () => {
  const db = getDatabase(USER);
  await db.sequelize.sync();
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;

  const today = D.todayET();
  let r = await post('/paychecks/sources', { name: 'Job', amount: '1500', schedule_type: 'weekly', anchor_date: D.addDays(today, -7), holiday_rule: 'none' });
  assert.strictEqual(r.status, 302);
  r = await post('/paychecks/sources', { name: 'Bad', amount: '1', schedule_type: 'semi_monthly', day1: '1' });
  assert.match(r.headers.get('location'), /error=/);

  // backdate creation so last week's payday is askable
  await db.PaySource.update({ createdAt: new Date(Date.now() - 30 * 864e5) }, { where: {}, silent: true });
  await db.Subscription.create({ name: 'Music', amount: 10, frequency: 'monthly' });
  await db.Debt.create({ name: 'Card', amount: 1000, balance: 1000, interest_rate: 20, minimum_payment: 40, due_day: 15 });

  let page = await (await fetch(base + '/plan')).text();
  assert.match(page, /What did you get paid on/);
  assert.match(page, /Debt planner/);

  const jsonA = await (await fetch(base + '/plan.json')).json();
  const pend = jsonA.plan.pending[0];
  r = await post('/paychecks/checkin', { source_id: pend.source_id, pay_date: pend.pay_date, amount: '1400' });
  assert.match(r.headers.get('location'), /success=/);
  r = await post('/paychecks/checkin', { source_id: pend.source_id, pay_date: D.addDays(today, 40), amount: '1' });
  assert.match(r.headers.get('location'), /error=/);

  page = await (await fetch(base + '/paychecks')).text();
  assert.match(page, /Estimated vs actual/);
  assert.match(page, /\$1,400\.00/);

  // a subscription date change shows up on the very next read
  const sub = await db.Subscription.findOne();
  const before = (await (await fetch(base + '/plan.json')).json()).plan;
  await post(`/plan/bills/subscription/${sub.id}`, { next_due_date: D.addDays(today, 1) });
  const after_ = (await (await fetch(base + '/plan.json')).json()).plan;
  assert.ok(!before.periods.flatMap(p => p.bills).some(b => b.name === 'Music'), 'undated sub is only a reserve');
  assert.ok(after_.periods.flatMap(p => p.bills).some(b => b.name === 'Music'));
  assert.ok((await fetch(base + '/plan/bills')).ok);

  await post('/plan/settings', { strategy: 'snowball', cushion: '25', periods_ahead: '3', avg_window: '2' });
  assert.strictEqual((await (await fetch(base + '/plan.json')).json()).plan.settings.strategy, 'snowball');
});

after(async () => {
  if (server) await new Promise(r => server.close(r));
  for (const f of [dbFile, dbFile + '-journal']) try { fs.unlinkSync(f); } catch {}
});
