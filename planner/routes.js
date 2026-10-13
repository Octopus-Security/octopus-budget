'use strict';
/**
 * Routes for the paycheck plan and debt planner. Registered from index.js with
 * one call; kept out of that file (and out of the dashboard views) so the
 * unmerged customizable-dashboard branch has nothing to collide with.
 */
const D = require('./dates');
const S = require('./schedule');
const P = require('./payday');
const { buildPlan, DEFAULTS } = require('./plan');

const fmt = n => (n < 0 ? '-$' : '$') + Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? Math.round(n * 100) / 100 : null;
}

/** Form body -> PaySource fields, or { error }. */
function parseSource(b) {
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) return { error: 'Give the income source a name.' };
  const amount = money(b.amount);
  if (amount === null) return { error: 'Enter the estimated amount per check.' };
  const type = String(b.schedule_type || '');
  let days = [];
  if (type === 'semi_monthly') days = [Number(b.day1), Number(b.day2)];
  else if (type === 'monthly') days = [Number(b.day1)];
  else if (type === 'custom') days = String(b.custom_dates || '').split(/[\s,;]+/).filter(Boolean);
  const f = {
    name, amount, schedule_type: type,
    anchor_date: (type === 'weekly' || type === 'biweekly') ? String(b.anchor_date || '') : null,
    days: JSON.stringify(days),
    holiday_rule: S.RULES.includes(b.holiday_rule) ? b.holiday_rule : 'previous_business_day',
    use_rolling_average: b.use_rolling_average === 'on' || b.use_rolling_average === '1',
  };
  const err = S.validate({ ...f, days });
  return err ? { error: err } : { fields: f };
}

async function load(db) {
  const [sources, paychecks, subs, installments, debts, dates, setting] = await Promise.all([
    db.PaySource.findAll({ order: [['id', 'ASC']] }),
    db.Paycheck.findAll(),
    db.Subscription.findAll(),
    db.Installment.findAll(),
    db.Debt.findAll(),
    db.BillDate.findAll({ where: { kind: 'subscription' } }),
    db.PlannerSetting.findByPk(1),
  ]);
  const plain = rows => rows.map(r => r.get({ plain: true }));
  const billDates = {};
  for (const d of dates) billDates[d.ref_id] = d.next_due_date;
  return {
    sources: plain(sources), paychecks: plain(paychecks), subs: plain(subs),
    installments: plain(installments), debts: plain(debts), billDates,
    settings: setting ? setting.get({ plain: true }) : { ...DEFAULTS },
  };
}

/** Everything the pages need, computed fresh from the database. Never cached. */
async function computePlan(db, today = D.todayET()) {
  const data = await load(db);
  return { data, plan: buildPlan({ ...data, today }) };
}

function register(app, { requireLogin, getDatabase }) {
  const back = (res, path, kind, msg) => res.redirect(`${path}?${kind}=${encodeURIComponent(msg)}`);
  const flash = req => ({ error: req.query.error || '', success: req.query.success || '' });
  const render = (req, res, name, title, extra) => res.render(name, { title, fmt, ...flash(req), ...extra });

  // ── Plan + debt planner ────────────────────────────────────────────────────
  app.get('/plan', requireLogin, async (req, res) => {
    const { data, plan } = await computePlan(getDatabase(req.user.username));
    render(req, res, 'plan', 'Paycheck Plan', { plan, data, user: req.user });
  });

  app.get('/plan.json', requireLogin, async (req, res) => {
    const { plan } = await computePlan(getDatabase(req.user.username));
    res.json({ ok: true, plan });
  });

  app.post('/plan/settings', requireLogin, async (req, res) => {
    const strategy = req.body.strategy === 'snowball' ? 'snowball' : 'avalanche';
    const cushion = money(req.body.cushion) ?? 0;
    const ahead = Math.min(26, Math.max(1, parseInt(req.body.periods_ahead, 10) || DEFAULTS.periods_ahead));
    const win = Math.min(24, Math.max(1, parseInt(req.body.avg_window, 10) || DEFAULTS.avg_window));
    const { PlannerSetting } = getDatabase(req.user.username);
    await PlannerSetting.upsert({ id: 1, strategy, cushion, periods_ahead: ahead, avg_window: win });
    back(res, '/plan', 'success', 'Planner settings saved.');
  });

  // ── Bill dates: the real due date a subscription (and a debt's due day) is on
  app.get('/plan/bills', requireLogin, async (req, res) => {
    const { data } = await computePlan(getDatabase(req.user.username));
    render(req, res, 'plan_bills', 'Bill dates', { data, user: req.user });
  });

  app.post('/plan/bills/subscription/:id', requireLogin, async (req, res) => {
    const { Subscription, BillDate } = getDatabase(req.user.username);
    const sub = await Subscription.findByPk(parseInt(req.params.id, 10));
    if (!sub) return back(res, '/plan/bills', 'error', 'No such subscription.');
    const date = String(req.body.next_due_date || '').trim();
    if (!date) await BillDate.destroy({ where: { kind: 'subscription', ref_id: sub.id } });
    else if (!D.isYmd(date)) return back(res, '/plan/bills', 'error', 'Enter the date as YYYY-MM-DD.');
    else await BillDate.upsert({ kind: 'subscription', ref_id: sub.id, next_due_date: date });
    back(res, '/plan/bills', 'success', `Saved the due date for ${sub.name}.`);
  });

  app.post('/plan/bills/debt/:id', requireLogin, async (req, res) => {
    const { Debt } = getDatabase(req.user.username);
    const debt = await Debt.findByPk(parseInt(req.params.id, 10));
    if (!debt) return back(res, '/plan/bills', 'error', 'No such debt.');
    const raw = String(req.body.due_day || '').trim();
    const day = raw === '' ? null : parseInt(raw, 10);
    if (day !== null && !(day >= 1 && day <= 31)) return back(res, '/plan/bills', 'error', 'Due day must be 1-31.');
    debt.due_day = day;
    await debt.save();
    back(res, '/plan/bills', 'success', `Saved the due day for ${debt.name}.`);
  });

  // ── Income sources, payday check-in, history ───────────────────────────────
  app.get('/paychecks', requireLogin, async (req, res) => {
    const { data, plan } = await computePlan(getDatabase(req.user.username));
    const history = data.paychecks.filter(P.hasActual)
      .sort((a, b) => b.pay_date.localeCompare(a.pay_date)).slice(0, 40)
      .map(p => ({ ...p, source: (data.sources.find(s => s.id === p.source_id) || {}).name || '(removed source)' }));
    const averages = {};
    for (const s of data.sources) averages[s.id] = P.rollingAverage(data.paychecks, s.id, data.settings.avg_window);
    const nextPayday = {};
    for (const s of data.sources) nextPayday[s.id] = S.generatePaydays(s, plan.today, D.addDays(plan.today, 70))[0];
    render(req, res, 'paychecks', 'Paychecks', { plan, data, history, averages, nextPayday, user: req.user, S });
  });

  app.post('/paychecks/sources', requireLogin, async (req, res) => {
    const r = parseSource(req.body);
    if (r.error) return back(res, '/paychecks', 'error', r.error);
    await getDatabase(req.user.username).PaySource.create(r.fields);
    back(res, '/paychecks', 'success', 'Income source added.');
  });

  app.post('/paychecks/sources/:id', requireLogin, async (req, res) => {
    const { PaySource } = getDatabase(req.user.username);
    const src = await PaySource.findByPk(parseInt(req.params.id, 10));
    if (!src) return back(res, '/paychecks', 'error', 'No such income source.');
    const r = parseSource(req.body);
    if (r.error) return back(res, '/paychecks', 'error', r.error);
    await src.update(r.fields);
    back(res, '/paychecks', 'success', 'Income source updated.');
  });

  app.post('/paychecks/sources/:id/delete', requireLogin, async (req, res) => {
    const { PaySource } = getDatabase(req.user.username);
    const src = await PaySource.findByPk(parseInt(req.params.id, 10));
    if (src) await src.destroy();   // past paychecks stay as history
    back(res, '/paychecks', 'success', 'Income source removed (its history is kept).');
  });

  app.post('/paychecks/sources/:id/apply-average', requireLogin, async (req, res) => {
    const db = getDatabase(req.user.username);
    const src = await db.PaySource.findByPk(parseInt(req.params.id, 10));
    if (!src) return back(res, '/paychecks', 'error', 'No such income source.');
    const set = await db.PlannerSetting.findByPk(1);
    const avg = P.rollingAverage((await db.Paycheck.findAll()).map(r => r.get({ plain: true })), src.id, set ? set.avg_window : DEFAULTS.avg_window);
    if (avg === null) return back(res, '/paychecks', 'error', 'No recorded paychecks to average yet.');
    await src.update({ amount: avg });
    back(res, '/paychecks', 'success', `${src.name} estimate set to ${fmt(avg)}.`);
  });

  // The payday question: record (or correct) what actually arrived.
  app.post('/paychecks/checkin', requireLogin, async (req, res) => {
    const db = getDatabase(req.user.username);
    const back_ = req.body.next === 'plan' ? '/plan' : '/paychecks';
    const src = await db.PaySource.findByPk(parseInt(req.body.source_id, 10));
    const date = String(req.body.pay_date || '');
    const amount = money(req.body.amount);
    if (!src) return back(res, back_, 'error', 'No such income source.');
    if (amount === null) return back(res, back_, 'error', 'Enter the amount as a number.');
    if (!D.isYmd(date) || date > D.todayET()) return back(res, back_, 'error', 'That payday has not happened yet.');
    // Only real paydays of this source (or one already recorded) can be checked in.
    const known = S.generatePaydays(src, D.addDays(date, -1), D.addDays(date, 1)).includes(date)
      || await db.Paycheck.findOne({ where: { source_id: src.id, pay_date: date } });
    if (!known) return back(res, back_, 'error', `${date} is not a payday for ${src.name}.`);
    const all = (await db.Paycheck.findAll()).map(r => r.get({ plain: true }));
    const set = await db.PlannerSetting.findByPk(1);
    const est = P.effectiveEstimate(src.get({ plain: true }), all, set ? set.avg_window : DEFAULTS.avg_window);
    const row = await db.Paycheck.findOne({ where: { source_id: src.id, pay_date: date } });
    if (row) await row.update({ actual_amount: amount });
    else await db.Paycheck.create({ source_id: src.id, pay_date: date, estimated_amount: est, actual_amount: amount });
    back(res, back_, 'success', `Recorded ${fmt(amount)} for ${src.name} on ${date}.`);
  });
}

module.exports = { register, computePlan, load, parseSource, money, fmt };
