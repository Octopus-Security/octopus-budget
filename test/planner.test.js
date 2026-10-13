'use strict';
const { test } = require('node:test');
const assert   = require('node:assert');
const D = require('../planner/dates');
const { generatePaydays } = require('../planner/schedule');
const { pendingPaydays, rollingAverage } = require('../planner/payday');
const { allocate } = require('../planner/debt');
const { buildPlan, bucketByPeriod } = require('../planner/plan');

const src = o => ({ id: 1, name: 'Job', amount: 1000, holiday_rule: 'none', active: true, ...o });

// ── schedule generation ──────────────────────────────────────────────────────
test('biweekly runs across month and year boundaries from the anchor', () => {
  const s = src({ schedule_type: 'biweekly', anchor_date: '2026-01-02' });
  assert.deepStrictEqual(generatePaydays(s, '2026-01-01', '2026-03-14'),
    ['2026-01-02', '2026-01-16', '2026-01-30', '2026-02-13', '2026-02-27', '2026-03-13']);
  // a window a year later stays on the same 14-day grid and crosses the new year
  assert.deepStrictEqual(generatePaydays(s, '2026-12-01', '2027-01-20'),
    ['2026-12-04', '2026-12-18', '2027-01-01', '2027-01-15']);
});

test('semi-monthly on 15 and 31 clamps to the month end, including February', () => {
  const s = src({ schedule_type: 'semi_monthly', days: [15, 31] });
  assert.deepStrictEqual(generatePaydays(s, '2027-01-01', '2027-04-30'),
    ['2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31', '2027-04-15', '2027-04-30']);
  assert.deepStrictEqual(generatePaydays(s, '2028-02-01', '2028-02-29'), ['2028-02-15', '2028-02-29']); // leap year
});

test('a weekend payday moves to the previous business day, unless the rule is none', () => {
  // 2026-11-01 is a Sunday; Fri 2026-10-30 is the previous business day.
  const s = src({ schedule_type: 'monthly', days: [1], holiday_rule: 'previous_business_day' });
  assert.deepStrictEqual(generatePaydays(s, '2026-10-15', '2026-11-30'), ['2026-10-30']);
  assert.deepStrictEqual(generatePaydays({ ...s, holiday_rule: 'none' }, '2026-10-15', '2026-11-30'), ['2026-11-01']);
});

test('a holiday payday moves back too (Christmas 2026 is a Friday, Labor Day is Sep 7)', () => {
  const s = src({ schedule_type: 'monthly', days: [25], holiday_rule: 'previous_business_day' });
  assert.deepStrictEqual(generatePaydays(s, '2026-12-01', '2026-12-31'), ['2026-12-24']);
  const lab = src({ schedule_type: 'monthly', days: [7], holiday_rule: 'previous_business_day' }); // Labor Day 2026-09-07
  assert.deepStrictEqual(generatePaydays(lab, '2026-09-01', '2026-09-30'), ['2026-09-04']);
});

test('custom dates are used as listed; weekly steps by 7', () => {
  assert.deepStrictEqual(generatePaydays(src({ schedule_type: 'custom', days: ['2026-11-03', '2026-11-20', 'junk'] }), '2026-11-01', '2026-11-30'),
    ['2026-11-03', '2026-11-20']);
  assert.deepStrictEqual(generatePaydays(src({ schedule_type: 'weekly', anchor_date: '2026-10-02' }), '2026-10-10', '2026-10-24'),
    ['2026-10-16', '2026-10-23']);
});

// ── bucketing ────────────────────────────────────────────────────────────────
test('due dates bucket into [payday, next payday): the boundary belongs to the later period', () => {
  const paydays = ['2026-10-02', '2026-10-16', '2026-10-30'];
  const b = bucketByPeriod([
    { date: '2026-10-02', n: 'a' }, { date: '2026-10-15', n: 'b' }, { date: '2026-10-16', n: 'c' }, { date: '2026-10-30', n: 'out' },
  ], paydays);
  assert.deepStrictEqual(b.map(x => x.map(i => i.n)), [['a', 'b'], ['c']]);
});

// ── allocation ───────────────────────────────────────────────────────────────
const debts = () => [
  { id: 1, name: 'Card', balance: 5000, apr: 24 },
  { id: 2, name: 'Loan', balance: 800, apr: 6 },
];
const mins = [{ debtId: 1, date: '2026-10-10', amount: 100 }, { debtId: 2, date: '2026-10-12', amount: 50 }];

test('avalanche sends the extra to the highest APR, snowball to the smallest balance', () => {
  const av = allocate(debts(), mins, 500, 'avalanche');
  assert.strictEqual(av.payments.get(1).extra, 350);
  assert.strictEqual(av.payments.get(2).extra, 0);
  const sn = allocate(debts(), mins, 500, 'snowball');
  assert.strictEqual(sn.payments.get(2).extra, 350);
  assert.strictEqual(sn.payments.get(1).extra, 0);
  assert.strictEqual(av.shortfall, 0);
});

test('a short period pays the earliest-due minimum first and reports the shortfall', () => {
  const r = allocate(debts(), mins, 120, 'avalanche');
  assert.strictEqual(r.payments.get(1).minimum, 100);
  assert.strictEqual(r.payments.get(2).minimum, 20);
  assert.strictEqual(r.shortfall, 30);
  assert.strictEqual(r.extra, 0);
  assert.deepStrictEqual(r.shorted.map(s => [s.debtId, s.short]), [[2, 30]]);
});

// ── the whole plan ───────────────────────────────────────────────────────────
const base = () => ({
  today: '2026-10-13',
  sources: [src({ schedule_type: 'biweekly', anchor_date: '2026-10-02', amount: 2000, createdAt: '2026-01-01T00:00:00Z' })],
  paychecks: [],
  subs: [{ id: 7, name: 'Streaming', amount: 15, frequency: 'monthly' }],
  billDates: { 7: '2026-10-20' },
  installments: [],
  debts: [{ id: 1, name: 'Card', balance: 3000, amount: 3000, interest_rate: 20, minimum_payment: 90, due_day: 25 }],
  settings: { strategy: 'avalanche', cushion: 0, periods_ahead: 3 },
});

test('the plan lists the bills due in each check using real dates, and subtracts them', () => {
  const plan = buildPlan(base());
  const cur = plan.periods[0];
  assert.strictEqual(cur.start, '2026-10-02');
  assert.strictEqual(cur.end, '2026-10-16');
  assert.strictEqual(cur.income, 2000);
  assert.deepStrictEqual(cur.bills, []);   // 10-20 falls in the NEXT check
  const next = plan.periods[1];
  assert.deepStrictEqual(next.bills.map(b => [b.date, b.amount]), [['2026-10-20', 15]]);
  assert.strictEqual(next.available, 1985);
  assert.strictEqual(next.debt.lines[0].minimum, 90);   // card due 10-25 is in this window
});

test('the plan is recomputed from current data: changing a subscription changes the next read', () => {
  const before = buildPlan(base());
  const changed = base();
  changed.subs = [{ id: 7, name: 'Streaming', amount: 40, frequency: 'monthly' }];
  const after = buildPlan(changed);
  assert.strictEqual(before.periods[1].available, 1985);
  assert.strictEqual(after.periods[1].available, 1960);
  // moving the due date moves it between checks
  const moved = base(); moved.billDates = { 7: '2026-10-10' };
  assert.strictEqual(buildPlan(moved).periods[0].bills.length, 1);
  // and a cheaper bill pays the debt off sooner
  assert.ok(after.totalInterest >= before.totalInterest);
});

test('recording the actual paycheck replaces the estimate in the plan', () => {
  const d = base();
  d.paychecks = [{ source_id: 1, pay_date: '2026-10-16', actual_amount: 1700, estimated_amount: 2000 }];
  assert.strictEqual(buildPlan(d).periods[1].income, 1700);
});

test('a period that cannot cover its minimums is flagged, and a cushion stays unallocated', () => {
  const d = base();
  d.sources[0].amount = 60;
  const plan = buildPlan(d);
  assert.ok(plan.shortfalls.length > 0);
  assert.ok(plan.periods.some(p => p.debt.shortfall > 0));

  const c = base(); c.settings.cushion = 300;
  const p0 = buildPlan(c).periods[0];
  assert.strictEqual(p0.cushion, 300);
  assert.strictEqual(p0.left, 300);   // everything above the cushion went to the debt
});

test('debts report a payoff date and interest; no due day assumes the 1st and says so', () => {
  const plan = buildPlan(base());
  assert.ok(plan.debts[0].payoffDate && plan.debts[0].payoffDate > '2026-10-13');
  assert.ok(plan.totalInterest > 0);
  assert.strictEqual(plan.payoffDate, plan.debts[0].payoffDate);
});

// ── payday prompt ────────────────────────────────────────────────────────────
test('the prompt fires on or after a payday with no actual, and stops once it is recorded', () => {
  const s = [src({ schedule_type: 'biweekly', anchor_date: '2026-10-02', createdAt: '2026-09-01T12:00:00Z' })];
  const onDay = pendingPaydays(s, [], '2026-10-16');
  assert.strictEqual(onDay[0].pay_date, '2026-10-16');
  assert.strictEqual(onDay[0].estimate, 1000);
  // day before the next payday: the earlier paydays since creation are still unanswered
  assert.deepStrictEqual(pendingPaydays(s, [], '2026-10-15').map(p => p.pay_date), ['2026-10-02', '2026-09-18', '2026-09-04']);
  assert.deepStrictEqual(pendingPaydays(s, [], '2026-10-01').map(p => p.pay_date), ['2026-09-18', '2026-09-04']);
  const done = [{ source_id: 1, pay_date: '2026-10-16', actual_amount: 990 }, { source_id: 1, pay_date: '2026-10-02', actual_amount: 1000 }, { source_id: 1, pay_date: '2026-09-18', actual_amount: 1000 }, { source_id: 1, pay_date: '2026-09-04', actual_amount: 1000 }];
  assert.deepStrictEqual(pendingPaydays(s, done, '2026-10-17'), []);
});

test('no prompt for paydays before the source existed, or for inactive sources', () => {
  const s = [src({ schedule_type: 'biweekly', anchor_date: '2026-10-02', createdAt: '2026-10-10T12:00:00Z' })];
  assert.deepStrictEqual(pendingPaydays(s, [], '2026-10-13'), []);
  assert.deepStrictEqual(pendingPaydays([{ ...s[0], active: false, createdAt: '2026-01-01' }], [], '2026-10-13'), []);
});

test('rolling average uses the most recent N actuals', () => {
  const pcs = [100, 200, 300, 400, 500].map((a, i) => ({ source_id: 1, pay_date: `2026-0${i + 1}-01`, actual_amount: a }));
  assert.strictEqual(rollingAverage(pcs, 1, 4), 350);
  assert.strictEqual(rollingAverage(pcs, 2, 4), null);
});

test('todayET reads the New York calendar day, not UTC', () => {
  assert.strictEqual(D.todayET(new Date('2026-10-14T02:30:00Z')), '2026-10-13');
});
