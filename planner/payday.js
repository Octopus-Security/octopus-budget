'use strict';
/** Payday check-in logic: which paydays still need an answer, and the rolling average. */
const D = require('./dates');
const { generatePaydays } = require('./schedule');

const LOOKBACK_DAYS = 45;
const c = n => Math.round(n * 100) / 100;

const hasActual = p => p && p.actual_amount !== null && p.actual_amount !== undefined;

/** Source's creation date as an ET calendar day; paydays before it are never asked about. */
function createdFloor(src) {
  const t = src.createdAt ? new Date(src.createdAt) : null;
  return t && !isNaN(t) ? D.todayET(t) : null;
}

/**
 * Paydays on or before `today` (and within the lookback) with no actual amount.
 * Newest first. Each carries the estimate to prefill.
 */
function pendingPaydays(sources, paychecks, today, estimateOf = s => Number(s.amount) || 0) {
  const out = [];
  for (const s of sources) {
    if (s.active === false) continue;
    let from = D.addDays(today, -LOOKBACK_DAYS);
    const floor = createdFloor(s);
    if (floor && D.diffDays(floor, from) > 0) from = floor;
    for (const date of generatePaydays(s, from, today)) {
      const rec = paychecks.find(p => p.source_id === s.id && p.pay_date === date);
      if (!hasActual(rec)) out.push({ source_id: s.id, source: s.name, pay_date: date, estimate: estimateOf(s) });
    }
  }
  return out.sort((a, b) => b.pay_date.localeCompare(a.pay_date) || a.source.localeCompare(b.source));
}

/** Mean of the last `window` recorded actuals for a source, or null with none. */
function rollingAverage(paychecks, sourceId, window = 4) {
  const rows = paychecks.filter(p => p.source_id === sourceId && hasActual(p))
    .sort((a, b) => b.pay_date.localeCompare(a.pay_date)).slice(0, Math.max(1, window));
  if (!rows.length) return null;
  return c(rows.reduce((t, r) => t + Number(r.actual_amount), 0) / rows.length);
}

/** The estimate the plan uses: the rolling average when the source opts in and has history. */
function effectiveEstimate(src, paychecks, window) {
  if (src.use_rolling_average) {
    const avg = rollingAverage(paychecks, src.id, window);
    if (avg !== null) return avg;
  }
  return Number(src.amount) || 0;
}

module.exports = { LOOKBACK_DAYS, hasActual, pendingPaydays, rollingAverage, effectiveEstimate };
