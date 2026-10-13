'use strict';
/**
 * Calendar-date helpers. Every date in the planner is a plain 'YYYY-MM-DD'
 * string meaning an America/New_York calendar day (ET is the estate's only
 * clock). Arithmetic goes through UTC day numbers so no machine timezone or
 * DST shift can move a payday.
 */

const MS_DAY = 86400000;

function todayET(now = new Date()) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function isYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

function toNum(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / MS_DAY; }
function fromNum(n) { return new Date(n * MS_DAY).toISOString().slice(0, 10); }

function addDays(s, n) { return fromNum(toNum(s) + n); }
function diffDays(a, b) { return toNum(a) - toNum(b); }

/** 0 = Sunday ... 6 = Saturday */
function weekday(s) { return new Date(toNum(s) * MS_DAY).getUTCDay(); }

/** Add months, clamping the day into the target month (Jan 31 + 1 month = Feb 28/29). */
function addMonthsClamped(s, months, day) {
  const [y, m, d] = s.split('-').map(Number);
  const idx = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  const dd = Math.min(day == null ? d : day, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** The nth (1-based) given weekday of a month; n = -1 for the last one. */
function nthWeekday(y, m, wd, n) {
  if (n > 0) {
    const first = weekday(`${y}-${String(m).padStart(2, '0')}-01`);
    const day = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const dim = daysInMonth(y, m);
  const last = weekday(`${y}-${String(m).padStart(2, '0')}-${dim}`);
  const day = dim - ((last - wd + 7) % 7);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const _holidayCache = new Map();
/**
 * US federal holidays (the days banks do not move money) for one year, as a Set.
 * A Sunday holiday is observed Monday. A Saturday holiday is NOT moved to
 * Friday: the Federal Reserve stays open that Friday, and Saturday is already a
 * non-business day anyway.
 */
function holidays(y) {
  if (_holidayCache.has(y)) return _holidayCache.get(y);
  const p = n => String(n).padStart(2, '0');
  const fixed = [[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]].map(([m, d]) => `${y}-${p(m)}-${p(d)}`);
  const set = new Set();
  for (const h of fixed) set.add(weekday(h) === 0 ? addDays(h, 1) : h);
  // New Year's Day of NEXT year falling on a Sunday is observed Monday (in next year), nothing to add here.
  set.add(nthWeekday(y, 1, 1, 3));   // MLK
  set.add(nthWeekday(y, 2, 1, 3));   // Presidents
  set.add(nthWeekday(y, 5, 1, -1));  // Memorial
  set.add(nthWeekday(y, 9, 1, 1));   // Labor
  set.add(nthWeekday(y, 10, 1, 2));  // Columbus / Indigenous Peoples
  set.add(nthWeekday(y, 11, 4, 4));  // Thanksgiving
  _holidayCache.set(y, set);
  return set;
}

function isBusinessDay(s) {
  const wd = weekday(s);
  if (wd === 0 || wd === 6) return false;
  return !holidays(Number(s.slice(0, 4))).has(s);
}

function previousBusinessDay(s) {
  let d = s;
  while (!isBusinessDay(d)) d = addDays(d, -1);
  return d;
}

module.exports = {
  todayET, isYmd, daysInMonth, addDays, diffDays, weekday, addMonthsClamped,
  nthWeekday, holidays, isBusinessDay, previousBusinessDay,
};
