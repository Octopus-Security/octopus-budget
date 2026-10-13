'use strict';
/**
 * Real due dates for things that cost money on a cycle.
 * Each function returns [{ date, amount, name, kind, ref }] inside [from, to].
 */
const D = require('./dates');

const STEP = { daily: ['d', 1], weekly: ['d', 7], biweekly: ['d', 14], monthly: ['m', 1], yearly: ['m', 12] };

/** Walk a cycle forward from an anchor date, yielding dates in [from, to]. */
function cycleDates(anchor, frequency, from, to, limit = Infinity) {
  const out = [];
  const step = STEP[frequency];
  if (!step || !D.isYmd(anchor)) return out;
  const [unit, n] = step;
  const anchorDay = Number(anchor.slice(8));
  let i = 0, d;
  const at = k => unit === 'd' ? D.addDays(anchor, k * n) : D.addMonthsClamped(anchor, k * n, anchorDay);
  // Skip ahead without iterating years of history for a stale anchor.
  if (unit === 'd') {
    const skip = Math.max(0, Math.floor(D.diffDays(from, anchor) / n));
    i = skip;
  } else {
    const [fy, fm] = from.split('-').map(Number), [ay, am] = anchor.split('-').map(Number);
    i = Math.max(0, Math.floor(((fy * 12 + fm) - (ay * 12 + am)) / n) - 1);
  }
  for (;; i++) {
    if (i >= limit) break;
    d = at(i);
    if (D.diffDays(d, to) > 0) break;
    if (D.diffDays(d, from) >= 0) out.push(d);
  }
  return out;
}

/**
 * Subscriptions. `dateOf(id)` gives a user-set next_due_date or undefined.
 * Undated subscriptions cannot be placed on the calendar: they come back in
 * `undated` so the plan can reserve a prorated amount rather than ignore them.
 */
function subscriptionBills(subs, dateOf, from, to) {
  const dated = [], undated = [];
  for (const s of subs) {
    const amount = Number(s.amount) || 0;
    const anchor = dateOf(s.id);
    if (!anchor) { undated.push({ name: s.name, amount, frequency: s.frequency, kind: 'subscription', ref: s.id }); continue; }
    for (const date of cycleDates(anchor, s.frequency, from, to)) {
      dated.push({ date, amount, name: s.name, kind: 'subscription', ref: s.id });
    }
  }
  return { dated, undated };
}

/** BNPL plans: next_due_date, then every `frequency`, for the payments left. */
function installmentBills(plans, from, to) {
  const out = [];
  for (const p of plans) {
    const left = Math.max(0, Number(p.remaining_payments) || 0);
    if (!left) continue;
    const freq = p.frequency === 'monthly' ? 'monthly' : 'biweekly';
    for (const date of cycleDates(p.next_due_date, freq, from, to, left)) {
      out.push({ date, amount: Number(p.payment_amount) || 0, name: p.name, kind: 'installment', ref: p.id });
    }
  }
  return out;
}

/** Debt minimums: monthly on due_day (clamped to month length). Undated -> assumed the 1st. */
function debtDues(debts, from, to) {
  const out = [];
  for (const d of debts) {
    const min = Number(d.minimum_payment) || 0;
    const day = Number.isInteger(Number(d.due_day)) && d.due_day >= 1 && d.due_day <= 31 ? Number(d.due_day) : 1;
    let cur = `${from.slice(0, 7)}-01`;
    while (D.diffDays(cur, to) <= 0) {
      const [y, m] = cur.split('-').map(Number);
      const date = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, D.daysInMonth(y, m))).padStart(2, '0')}`;
      if (D.diffDays(date, from) >= 0 && D.diffDays(date, to) <= 0) {
        out.push({ date, amount: min, name: d.name, kind: 'debt', ref: d.id, assumedDay: day !== Number(d.due_day) });
      }
      cur = D.addMonthsClamped(cur, 1, 1);
    }
  }
  return out;
}

const CYCLE_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30.4375, yearly: 365.25 };

module.exports = { cycleDates, subscriptionBills, installmentBills, debtDues, CYCLE_DAYS };
