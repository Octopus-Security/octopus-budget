'use strict';
/** Pure debt allocation. No I/O. Money is rounded to cents at the edges. */

const c = n => Math.round(n * 100) / 100;

/** Order extra-payment targets. avalanche: highest APR first; snowball: smallest balance first. */
function order(debts, strategy) {
  const live = debts.filter(d => d.balance > 0.004);
  const byBal = (a, b) => a.balance - b.balance || String(a.name).localeCompare(String(b.name));
  if (strategy === 'snowball') return live.sort(byBal);
  return live.sort((a, b) => (b.apr - a.apr) || byBal(a, b));
}

/**
 * One pay period's allocation.
 * debts:   [{ id, name, balance, apr }]  (balance mutated by the caller, not here)
 * mins:    [{ debtId, date, amount }]    minimums due before the next payday
 * budget:  money available for debt this period (already net of cushion)
 * Returns { payments: Map(id -> { minimum, extra }), minimumsDue, minimumsPaid,
 *           shortfall, extra, unspent, shorted: [{debtId, date, short}] }
 */
function allocate(debts, mins, budget, strategy) {
  let left = Math.max(0, budget);
  const byId = new Map(debts.map(d => [d.id, d]));
  const payments = new Map(debts.map(d => [d.id, { minimum: 0, extra: 0 }]));
  const remaining = new Map(debts.map(d => [d.id, d.balance]));
  let minimumsDue = 0, minimumsPaid = 0;
  const shorted = [];

  // Minimums first, earliest due date first, so a short period pays what falls due soonest.
  for (const m of [...mins].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!byId.has(m.debtId)) continue;
    const owed = Math.min(m.amount, remaining.get(m.debtId));
    if (owed <= 0) continue;
    minimumsDue += owed;
    const pay = Math.min(owed, left);
    left -= pay; minimumsPaid += pay;
    remaining.set(m.debtId, remaining.get(m.debtId) - pay);
    payments.get(m.debtId).minimum += pay;
    if (owed - pay > 0.004) shorted.push({ debtId: m.debtId, date: m.date, short: c(owed - pay) });
  }

  // Everything left goes to the strategy's target(s).
  let extra = 0;
  for (const d of order(debts.map(x => ({ ...x, balance: remaining.get(x.id) })), strategy)) {
    if (left <= 0.004) break;
    const pay = Math.min(left, remaining.get(d.id));
    left -= pay; extra += pay;
    remaining.set(d.id, remaining.get(d.id) - pay);
    payments.get(d.id).extra += pay;
  }

  return {
    payments, minimumsDue: c(minimumsDue), minimumsPaid: c(minimumsPaid),
    shortfall: c(minimumsDue - minimumsPaid), extra: c(extra), unspent: c(left), shorted,
  };
}

module.exports = { allocate, order, c };
