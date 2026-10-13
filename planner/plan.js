'use strict';
/**
 * The check-to-check plan, computed from current data on every call.
 * Nothing here is stored: change a subscription, bill date, debt or paycheck and
 * the next read is different. Pure: takes plain rows, returns plain objects.
 */
const D = require('./dates');
const { generatePaydays } = require('./schedule');
const { subscriptionBills, installmentBills, debtDues, CYCLE_DAYS } = require('./bills');
const { allocate, c } = require('./debt');
const { effectiveEstimate, pendingPaydays, hasActual } = require('./payday');

const HORIZON_YEARS = 15;
const DEFAULTS = { strategy: 'avalanche', cushion: 0, periods_ahead: 6, avg_window: 4 };

/** Put dated items into [payday_i, payday_i+1) windows. Items outside every window are dropped. */
function bucketByPeriod(items, paydays) {
  const buckets = paydays.slice(0, -1).map(() => []);
  for (const it of items) {
    for (let i = 0; i < buckets.length; i++) {
      if (it.date >= paydays[i] && it.date < paydays[i + 1]) { buckets[i].push(it); break; }
    }
  }
  return buckets;
}

function buildPlan(input) {
  const today = input.today || D.todayET();
  const settings = { ...DEFAULTS, ...(input.settings || {}) };
  const sources = (input.sources || []).filter(s => s.active !== false);
  const paychecks = input.paychecks || [];
  const dateOf = id => (input.billDates || {})[id];

  // ── paydays across every source; the current period starts at the latest one <= today
  const lookStart = D.addDays(today, -100);
  const horizon = D.addDays(today, HORIZON_YEARS * 366);
  const payRows = [];   // { date, source, amount, actual, recorded }
  for (const s of sources) {
    const est = effectiveEstimate(s, paychecks, settings.avg_window);
    for (const date of generatePaydays(s, lookStart, horizon)) {
      const rec = paychecks.find(p => p.source_id === s.id && p.pay_date === date);
      const recorded = hasActual(rec);
      payRows.push({
        date, source: s.name, source_id: s.id, recorded,
        amount: recorded ? Number(rec.actual_amount) : est,
        estimate: est,
        needsCheckin: !recorded && D.diffDays(date, today) <= 0,
      });
    }
  }
  const past = payRows.filter(r => r.date <= today).map(r => r.date).sort();
  const start = past.length ? past[past.length - 1] : today;
  const paydays = [...new Set(payRows.map(r => r.date).concat([]))].filter(d => d >= start).sort();
  const pending = pendingPaydays(sources, paychecks, today, s => effectiveEstimate(s, paychecks, settings.avg_window));

  const base = { today, settings, pending, periods: [], debts: [], totalInterest: 0, payoffDate: null,
                 shortfalls: [], undated: [], hasIncome: payRows.length > 0 };
  if (paydays.length < 2) return base;

  const lastEnd = paydays[paydays.length - 1];
  const bills = [
    ...subscriptionBills(input.subs || [], dateOf, start, D.addDays(lastEnd, -1)).dated,
    ...installmentBills(input.installments || [], start, D.addDays(lastEnd, -1)),
  ];
  const undated = subscriptionBills(input.subs || [], dateOf, start, start).undated;
  const billBuckets = bucketByPeriod(bills, paydays);

  const debtState = (input.debts || []).map(d => ({
    id: d.id, name: d.name,
    balance: Number(d.balance != null ? d.balance : d.amount) || 0,
    startBalance: Number(d.balance != null ? d.balance : d.amount) || 0,
    apr: Number(d.interest_rate) || 0,
    minimum: Number(d.minimum_payment) || 0,
    due_day: d.due_day || null,
    interest: 0, lastPayment: null, payoffDate: null,
  }));
  const dueFrom = start > today ? start : today;   // balances are current: earlier minimums are already paid
  const dues = bucketByPeriod(
    debtDues(input.debts || [], dueFrom, D.addDays(lastEnd, -1)), paydays);

  const periods = [];
  for (let i = 0; i < paydays.length - 1; i++) {
    const startD = paydays[i], endD = paydays[i + 1], days = D.diffDays(endD, startD);
    const incomeItems = payRows.filter(r => r.date === startD);
    const income = c(incomeItems.reduce((t, r) => t + r.amount, 0));
    const items = billBuckets[i].slice().sort((a, b) => a.date.localeCompare(b.date));
    const reserves = undated.map(u => ({ ...u, date: null, reserve: true,
      amount: c(u.amount * days / (CYCLE_DAYS[u.frequency] || 30.4375)) }));
    const billsTotal = c(items.concat(reserves).reduce((t, b) => t + b.amount, 0));
    const available = c(income - billsTotal);

    const mins = dues[i].filter(m => debtState.find(d => d.id === m.ref && d.balance > 0.004))
      .map(m => ({ debtId: m.ref, date: m.date, amount: m.amount }));
    const budget = Math.max(0, available - settings.cushion);
    const alloc = debtState.length
      ? allocate(debtState, mins, budget, settings.strategy)
      : { payments: new Map(), minimumsDue: 0, minimumsPaid: 0, shortfall: 0, extra: 0, unspent: c(budget), shorted: [] };

    const debtLines = [];
    for (const d of debtState) {
      const pay = alloc.payments.get(d.id);
      if (!pay || d.balance <= 0.004) continue;
      const paid = Math.min(d.balance, pay.minimum + pay.extra);
      if (paid > 0) {
        debtLines.push({ debtId: d.id, name: d.name, minimum: c(pay.minimum), extra: c(pay.extra) });
        d.balance -= paid;
        // Minimums land on their due date; extra lands on payday.
        const minDates = mins.filter(m => m.debtId === d.id).map(m => m.date);
        d.lastPayment = pay.extra > 0 || !minDates.length ? startD : minDates[minDates.length - 1];
      }
      if (d.balance <= 0.004) { d.balance = 0; d.payoffDate = d.lastPayment || startD; continue; }
      const interest = d.balance * (d.apr / 100) / 365 * days;
      d.interest += interest; d.balance += interest;
    }

    const shortfall = alloc.shortfall;
    periods.push({
      start: startD, end: endD, days, income, incomeItems, bills: items, reserves, billsTotal, available,
      overdrawn: available < 0,
      cushion: c(Math.min(settings.cushion, Math.max(0, available))),
      debt: {
        lines: debtLines, minimumsDue: alloc.minimumsDue, minimumsPaid: alloc.minimumsPaid,
        extra: alloc.extra, shortfall, shorted: alloc.shorted,
      },
      left: c(available - alloc.minimumsPaid - alloc.extra),
      current: i === 0,
    });
  }

  const shortfalls = periods.filter(p => p.debt.shortfall > 0 || p.overdrawn)
    .map(p => ({ start: p.start, end: p.end, shortfall: p.debt.shortfall, overdrawn: p.overdrawn, available: p.available }));

  const debts = debtState.map(d => ({
    id: d.id, name: d.name, startBalance: c(d.startBalance), apr: d.apr, minimum: d.minimum, due_day: d.due_day,
    payoffDate: d.payoffDate, totalInterest: c(d.interest),
    remaining: d.payoffDate ? 0 : c(d.balance),
  }));
  const dates = debts.map(d => d.payoffDate);
  return {
    ...base, periods, shortfalls, debts, undated,
    totalInterest: c(debts.reduce((t, d) => t + d.totalInterest, 0)),
    payoffDate: debts.length && dates.every(Boolean) ? dates.sort().pop() : null,
    shown: Math.min(periods.length, settings.periods_ahead + 1),
  };
}

module.exports = { buildPlan, bucketByPeriod, DEFAULTS, HORIZON_YEARS };
