'use strict';
/**
 * Pay schedules -> payday dates.
 *
 * A source is { schedule_type, anchor_date, days, holiday_rule }:
 *   weekly        every 7 days from anchor_date
 *   biweekly      every 14 days from anchor_date
 *   semi_monthly  days = [a, b] days of the month; a day past the month's end
 *                 (31 in a 30-day month, 30/31 in February) clamps to the last day
 *   monthly       days = [d], same clamping
 *   custom        days = explicit list of 'YYYY-MM-DD'
 * holiday_rule: 'previous_business_day' (default) | 'none'.
 */
const D = require('./dates');

const TYPES = ['weekly', 'biweekly', 'semi_monthly', 'monthly', 'custom'];
const RULES = ['previous_business_day', 'none'];

function parseDays(days) {
  if (Array.isArray(days)) return days;
  if (typeof days === 'string' && days.trim()) {
    try { const v = JSON.parse(days); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

function applyRule(date, rule) {
  return rule === 'none' ? date : D.previousBusinessDay(date);
}

/** Nominal (unadjusted) dates from `from` through `to`, widened a week to catch shifts. */
function nominalDates(src, from, to) {
  const out = [];
  const days = parseDays(src.days);
  const type = src.schedule_type;
  if (type === 'weekly' || type === 'biweekly') {
    if (!D.isYmd(src.anchor_date)) return out;
    const step = type === 'weekly' ? 7 : 14;
    const off = D.diffDays(from, src.anchor_date);
    let d = D.addDays(src.anchor_date, Math.floor(off / step) * step);
    while (D.diffDays(d, to) <= 0) { out.push(d); d = D.addDays(d, step); }
  } else if (type === 'semi_monthly' || type === 'monthly') {
    const want = days.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 31);
    const uniq = [...new Set(want)].slice(0, type === 'monthly' ? 1 : 2);
    let cur = `${from.slice(0, 7)}-01`;
    while (D.diffDays(cur, to) <= 0) {
      const [y, m] = cur.split('-').map(Number);
      for (const day of uniq) {
        out.push(`${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, D.daysInMonth(y, m))).padStart(2, '0')}`);
      }
      cur = D.addMonthsClamped(cur, 1, 1);
    }
  } else if (type === 'custom') {
    for (const d of days) if (D.isYmd(d)) out.push(d);
  }
  return out;
}

/** Adjusted payday dates in [from, to], sorted and de-duplicated. */
function generatePaydays(src, from, to) {
  const rule = RULES.includes(src.holiday_rule) ? src.holiday_rule : 'previous_business_day';
  const seen = new Set();
  for (const nom of nominalDates(src, D.addDays(from, -7), D.addDays(to, 7))) {
    const d = applyRule(nom, rule);
    if (D.diffDays(d, from) >= 0 && D.diffDays(d, to) <= 0) seen.add(d);
  }
  return [...seen].sort();
}

/** Validate user input; returns an error string or null. */
function validate(src) {
  if (!TYPES.includes(src.schedule_type)) return 'Unknown schedule type.';
  const days = parseDays(src.days);
  if (src.schedule_type === 'weekly' || src.schedule_type === 'biweekly') {
    if (!D.isYmd(src.anchor_date)) return 'Pick a known payday (anchor date) for this schedule.';
  } else if (src.schedule_type === 'semi_monthly') {
    if (days.length !== 2 || days.some(n => !(Number.isInteger(Number(n)) && n >= 1 && n <= 31))) return 'Semi-monthly needs two days of the month (1-31).';
  } else if (src.schedule_type === 'monthly') {
    if (days.length !== 1 || !(Number.isInteger(Number(days[0])) && days[0] >= 1 && days[0] <= 31)) return 'Monthly needs one day of the month (1-31).';
  } else if (src.schedule_type === 'custom') {
    if (!days.length || days.some(d => !D.isYmd(d))) return 'Custom needs at least one valid YYYY-MM-DD date.';
  }
  return null;
}

module.exports = { TYPES, RULES, parseDays, generatePaydays, validate };
