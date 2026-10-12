'use strict';

/**
 * Dashboard layout logic — pure, no database, no Express — so it can be unit
 * tested (test/layout.test.js).
 *
 * The dashboard is a layout layer over the built-in models: registries say what
 * exists by default, saved prefs (SectionPref / ColumnPref / TilePref and the
 * CustomSection rows) override title, order and visibility, and these functions
 * merge the two. Persistence lives in layout-store.js.
 *
 * Keys used on the wire and in the DOM:
 *   section  'subscriptions' ... (built-in)   |  'custom:<id>'
 *   column   'name', 'amount' ... (built-in)  |  'c:<ColumnPref.id>'
 *   tile     'totalDebt' ...      (built-in)  |  't:<TilePref.id>'
 */

const MAX_LABEL = 60;   // section / column / tile names
const MAX_TEXT  = 200;  // a text cell

const COLUMN_TYPES = ['text', 'number', 'money', 'date'];

// Registry order IS the default dashboard order.
const SECTIONS = [
  { key: 'subscriptions', title: 'Subscriptions',     icon: '📺', table: true },
  { key: 'debts',         title: 'Debts',             icon: '💳', table: true },
  { key: 'installments',  title: 'Installment Plans', icon: '🛍', table: true },
  { key: 'accounts',      title: 'Accounts',          icon: '🏦', table: true },
  { key: 'income',        title: 'Income',            icon: '💵', table: true },
  { key: 'credit_scores', title: 'Credit Scores',     icon: '📊', table: false },
  { key: 'transactions',  title: 'Transactions',      icon: '💸', table: true },
];

// Columns per table section. The Actions column is always last and not listed.
const COLUMNS = {
  subscriptions: [
    { key: 'name', label: 'Name' }, { key: 'amount', label: 'Amount' }, { key: 'frequency', label: 'Frequency' },
  ],
  accounts: [
    { key: 'name', label: 'Name' }, { key: 'balance', label: 'Balance' },
  ],
  income: [
    { key: 'amount', label: 'Amount' }, { key: 'frequency', label: 'Frequency' },
  ],
  debts: [
    { key: 'name', label: 'Name' }, { key: 'balance', label: 'Balance' },
    { key: 'credit_limit', label: 'Credit Limit' }, { key: 'available', label: 'Available' },
  ],
  installments: [
    { key: 'name', label: 'Name' }, { key: 'provider', label: 'Provider' }, { key: 'payment', label: 'Payment' },
    { key: 'remaining', label: 'Remaining' }, { key: 'total_left', label: 'Total Left' }, { key: 'next_due', label: 'Next Due' },
  ],
  transactions: [
    { key: 'date', label: 'Date' }, { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' }, { key: 'amount', label: 'Amount' },
  ],
};

// Summary tiles. defaultHidden ones exist but start off the dashboard.
const TILES = [
  { key: 'totalDebt',         title: 'Total Debt',          icon: '💳', cls: 'debt' },
  { key: 'monthlyIncome',     title: 'Monthly Income',      icon: '💵', cls: 'income' },
  { key: 'totalAccounts',     title: 'Total in Accounts',   icon: '🏦', cls: '' },
  { key: 'subscriptionTotal', title: 'Subscription Total',  icon: '📊', cls: '' },
  { key: 'monthlySpend',      title: "This Month's Spend",  icon: '💸', cls: 'debt' },
  { key: 'netWorth',          title: 'Net Worth',           icon: '🧮', cls: '', defaultHidden: true },
  { key: 'bnplUsed',          title: 'BNPL Used',           icon: '🛍', cls: 'debt', defaultHidden: true },
];

const SECTION_BY_KEY = new Map(SECTIONS.map((s, i) => [s.key, { ...s, seq: i }]));
const TILE_BY_KEY    = new Map(TILES.map((t, i) => [t.key, { ...t, seq: i }]));

// ── Keys ────────────────────────────────────────────────────────────────────

function customSectionKey(id) { return `custom:${id}`; }
function customColumnKey(id)  { return `c:${id}`; }
function customTileKey(id)    { return `t:${id}`; }

function parseId(prefix, key) {
  const m = new RegExp(`^${prefix}:(\\d{1,12})$`).exec(String(key));
  return m ? Number(m[1]) : null;
}
const parseCustomSectionKey = key => parseId('custom', key);
const parseCustomColumnKey  = key => parseId('c', key);
const parseCustomTileKey    = key => parseId('t', key);

function isBuiltinSection(key) { return SECTION_BY_KEY.has(key); }
/** True for a built-in section that is a table (credit_scores is not). */
function isTableSection(key)   { const s = SECTION_BY_KEY.get(key); return !!(s && s.table); }

// ── Validation ──────────────────────────────────────────────────────────────

/** Trim and cap a label. Returns the string, or null when it is empty/not a string. */
function cleanLabel(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_LABEL).trim();
  return s || null;
}

/**
 * Validate and normalise a cell value for a column type.
 * Blank means "clear the cell" ({ ok:true, value:null }).
 * Numbers and money are stored as plain decimal strings; dates as YYYY-MM-DD.
 */
function parseCellValue(type, raw) {
  if (!COLUMN_TYPES.includes(type)) return { ok: false, error: 'unknown column type' };
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string' && typeof raw !== 'number') return { ok: false, error: 'value must be a string or number' };
  const s = String(raw).trim();
  if (s === '') return { ok: true, value: null };

  if (type === 'text') {
    if (s.length > MAX_TEXT) return { ok: false, error: `text is limited to ${MAX_TEXT} characters` };
    return { ok: true, value: s };
  }
  if (type === 'number' || type === 'money') {
    const cleaned = type === 'money' ? s.replace(/^\$/, '').replace(/,/g, '') : s;
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return { ok: false, error: `${type} must be a number` };
    const n = Number(cleaned);
    if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { ok: false, error: `${type} is out of range` };
    return { ok: true, value: String(n) };
  }
  // date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: 'date must be YYYY-MM-DD' };
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false, error: 'not a real date' };
  return { ok: true, value: s };
}

// ── Ordering ────────────────────────────────────────────────────────────────

/**
 * Items with a saved integer position come first, in that order; items without
 * one (a built-in with no pref, e.g. added in a later release) follow in their
 * default order. Positions are then rewritten as 0..n-1.
 */
function orderItems(items) {
  const hasPos = it => Number.isInteger(it.position);
  const positioned = items.filter(hasPos).sort((a, b) => a.position - b.position || a.seq - b.seq);
  const rest = items.filter(it => !hasPos(it)).sort((a, b) => a.seq - b.seq);
  return [...positioned, ...rest].map((it, i) => {
    const { seq, ...out } = it;
    return { ...out, position: i };
  });
}

/**
 * Move the item with `key` one step (dir -1 earlier, +1 later). Returns a NEW
 * array with positions renormalised to 0..n-1. At the edges, or for an unknown
 * key, the order is unchanged (still returned normalised).
 */
function moveItem(items, key, dir) {
  const list = items.slice();
  const i = list.findIndex(it => it.key === key);
  const j = i + (dir < 0 ? -1 : 1);
  if (i !== -1 && j >= 0 && j < list.length) { const t = list[i]; list[i] = list[j]; list[j] = t; }
  return list.map((it, n) => ({ ...it, position: n }));
}

// ── Sections ────────────────────────────────────────────────────────────────

/**
 * @param prefRows   SectionPref rows as plain objects ({ key, title, position, hidden })
 * @param customRows CustomSection rows as plain objects ({ id, title, position, hidden })
 */
function resolveSections(prefRows, customRows) {
  const prefs = new Map();
  for (const p of prefRows || []) if (SECTION_BY_KEY.has(p.key)) prefs.set(p.key, p); // unknown keys ignored
  const items = [];
  for (const def of SECTIONS) {
    const p = prefs.get(def.key);
    const own = p && typeof p.title === 'string' && p.title.trim() !== '';
    items.push({
      key: def.key, builtin: true, table: def.table, icon: def.icon,
      defaultTitle: def.title,
      title: own ? p.title : def.title,
      customTitle: !!own,
      hidden: !!(p && p.hidden),
      position: p && Number.isInteger(p.position) ? p.position : null,
      seq: SECTION_BY_KEY.get(def.key).seq,
    });
  }
  for (const c of customRows || []) {
    items.push({
      key: customSectionKey(c.id), id: c.id, builtin: false, table: true, icon: '🗂',
      defaultTitle: c.title, title: c.title, customTitle: true,
      hidden: !!c.hidden,
      position: Number.isInteger(c.position) ? c.position : null,
      seq: 1000 + c.id,
    });
  }
  return orderItems(items);
}

// ── Columns ─────────────────────────────────────────────────────────────────

/**
 * @param sectionKey built-in section key or 'custom:<id>'
 * @param prefRows   ColumnPref rows (any section; filtered here) as plain objects
 */
function resolveColumns(sectionKey, prefRows) {
  const mine = (prefRows || []).filter(p => p.section_key === sectionKey);
  const items = [];
  const defs = COLUMNS[sectionKey] || []; // custom sections and credit_scores have no built-ins
  const builtinPrefs = new Map(mine.filter(p => p.builtin_key).map(p => [p.builtin_key, p]));
  defs.forEach((def, i) => {
    const p = builtinPrefs.get(def.key);
    items.push({
      key: def.key, id: p ? p.id : null, builtin: true, type: null,
      defaultLabel: def.label,
      label: p && p.label ? p.label : def.label,
      hidden: !!(p && p.hidden),
      position: p && Number.isInteger(p.position) ? p.position : null,
      seq: i,
    });
  });
  for (const p of mine.filter(p => !p.builtin_key)) {
    items.push({
      key: customColumnKey(p.id), id: p.id, builtin: false, type: p.type || 'text',
      defaultLabel: p.label, label: p.label,
      hidden: !!p.hidden,
      position: Number.isInteger(p.position) ? p.position : null,
      seq: 1000 + p.id,
    });
  }
  return orderItems(items);
}

// ── Tiles ───────────────────────────────────────────────────────────────────

/**
 * @param prefRows    TilePref rows as plain objects
 * @param columnsById Map/obj of custom ColumnPref id -> { id, label, type, section_key }.
 *                    A custom tile whose column no longer exists is dropped.
 */
function resolveTiles(prefRows, columnsById) {
  const byId = id => (columnsById instanceof Map ? columnsById.get(id) : columnsById && columnsById[id]);
  const builtinPrefs = new Map();
  for (const p of prefRows || []) if (p.key && TILE_BY_KEY.has(p.key)) builtinPrefs.set(p.key, p);
  const items = [];
  for (const def of TILES) {
    const p = builtinPrefs.get(def.key);
    const own = p && typeof p.title === 'string' && p.title.trim() !== '';
    items.push({
      key: def.key, builtin: true, icon: def.icon, cls: def.cls,
      defaultTitle: def.title,
      title: own ? p.title : def.title,
      customTitle: !!own,
      hidden: p ? !!p.hidden : !!def.defaultHidden,
      column_id: null,
      position: p && Number.isInteger(p.position) ? p.position : null,
      seq: TILE_BY_KEY.get(def.key).seq,
    });
  }
  for (const p of prefRows || []) {
    if (p.key) continue;
    const col = p.column_id != null ? byId(p.column_id) : null;
    if (!col) continue; // orphan: its column is gone
    items.push({
      key: customTileKey(p.id), id: p.id, builtin: false, icon: '🧩', cls: '',
      defaultTitle: p.title || col.label, title: p.title || col.label, customTitle: true,
      hidden: !!p.hidden, column_id: p.column_id, column_type: col.type,
      position: Number.isInteger(p.position) ? p.position : null,
      seq: 1000 + p.id,
    });
  }
  return orderItems(items);
}

/**
 * Sum a list of stored cell values, ignoring blanks and anything non-numeric.
 * No formulas, no eval: Number() on a validated decimal string only.
 */
function sumValues(values) {
  let total = 0;
  for (const v of values || []) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) continue;
    const n = Number(s);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

function formatMoney(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
}
function formatNumber(n) {
  const v = Number(n) || 0;
  return String(Math.round(v * 100) / 100);
}

/**
 * The text shown on a tile. Built-in tiles read the server-computed metric;
 * custom tiles sum their column's values (valuesByColumn: { [column_id]: [..] }).
 */
function tileValue(tile, metrics, valuesByColumn) {
  if (tile.builtin) {
    const v = metrics ? metrics[tile.key] : 0;
    return { value: Number(v) || 0, text: formatMoney(v) };
  }
  const sum = sumValues(valuesByColumn ? valuesByColumn[tile.column_id] : []);
  return { value: sum, text: tile.column_type === 'number' ? formatNumber(sum) : formatMoney(sum) };
}

/** The stock dashboard with no saved prefs — used if the saved layout cannot be loaded. */
function fallbackLayout(metrics) {
  const sections = resolveSections([], []).map(s => ({ ...s, columns: s.table ? resolveColumns(s.key, []) : [] }));
  const subs = (metrics && metrics.subs) || {};
  const tiles = resolveTiles([], new Map()).map(t => ({
    ...t, text: tileValue(t, metrics, {}).text, sub: subs[t.key] || '',
  }));
  return { sections, tiles, cv: {}, customRows: {}, sumColumns: [] };
}

module.exports = {
  fallbackLayout,
  MAX_LABEL, MAX_TEXT, COLUMN_TYPES,
  SECTIONS, COLUMNS, TILES,
  customSectionKey, customColumnKey, customTileKey,
  parseCustomSectionKey, parseCustomColumnKey, parseCustomTileKey,
  isBuiltinSection, isTableSection,
  cleanLabel, parseCellValue,
  orderItems, moveItem,
  resolveSections, resolveColumns, resolveTiles,
  sumValues, formatMoney, formatNumber, tileValue,
};
