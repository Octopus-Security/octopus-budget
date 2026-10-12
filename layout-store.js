'use strict';

/**
 * Persistence for the dashboard layout layer. `db` is the object returned by
 * getDatabase(username): a database per user, so unfiltered queries here are
 * correct — the file is the isolation boundary.
 *
 * Every layout mutation is "load the resolved list, change it in memory, save
 * the whole list". That one path is what creates SectionPref/ColumnPref/TilePref
 * rows on demand and keeps positions normalised, instead of a dozen bespoke
 * update statements that each have to remember to do both.
 */

const L = require('./layout');

// Which model backs a built-in table section's rows.
const SECTION_MODEL = {
  subscriptions: 'Subscription',
  debts:         'Debt',
  installments:  'Installment',
  accounts:      'Account',
  income:        'Income',
  transactions:  'Transaction',
};

const plain = rows => rows.map(r => r.get({ plain: true }));

// ── Existence and ownership ─────────────────────────────────────────────────

async function sectionExists(db, sectionKey) {
  if (L.isBuiltinSection(sectionKey)) return true;
  const id = L.parseCustomSectionKey(sectionKey);
  return id !== null && !!(await db.CustomSection.findByPk(id));
}

/**
 * Does `rowId` really belong to the section a column lives in?
 *
 * This is the check that stops a value being written against another section's
 * row (or a row that does not exist): for a built-in section the row must exist
 * in that section's own model; for a custom one it must be a CustomRow of that
 * very section. Without it a client could attach cells to any id.
 */
async function rowBelongsToSection(db, sectionKey, rowId) {
  if (!Number.isInteger(rowId) || rowId < 1) return false;
  const modelName = SECTION_MODEL[sectionKey];
  if (modelName) return !!(await db[modelName].findByPk(rowId));
  const sectionId = L.parseCustomSectionKey(sectionKey);
  if (sectionId === null) return false;
  const row = await db.CustomRow.findByPk(rowId);
  return !!row && row.section_id === sectionId;
}

// ── Loading ─────────────────────────────────────────────────────────────────

async function loadSections(db) {
  const [prefs, custom] = await Promise.all([db.SectionPref.findAll(), db.CustomSection.findAll()]);
  return L.resolveSections(plain(prefs), plain(custom));
}

async function loadColumns(db, sectionKey) {
  const rows = await db.ColumnPref.findAll({ where: { section_key: sectionKey } });
  return L.resolveColumns(sectionKey, plain(rows));
}

async function customColumnsById(db) {
  const cols = plain(await db.ColumnPref.findAll({ where: { builtin_key: null } }));
  return new Map(cols.map(c => [c.id, c]));
}

async function loadTiles(db) {
  const [prefs, byId] = await Promise.all([db.TilePref.findAll(), customColumnsById(db)]);
  return L.resolveTiles(plain(prefs), byId);
}

// ── Saving whole lists ──────────────────────────────────────────────────────

async function saveSections(db, items, t) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.builtin) {
      const fields = { title: it.customTitle ? it.title : null, position: i, hidden: !!it.hidden };
      const row = await db.SectionPref.findOne({ where: { key: it.key }, transaction: t });
      if (row) await row.update(fields, { transaction: t });
      else await db.SectionPref.create({ key: it.key, ...fields }, { transaction: t });
    } else {
      await db.CustomSection.update({ title: it.title, position: i, hidden: !!it.hidden }, { where: { id: it.id }, transaction: t });
    }
  }
}

async function saveColumns(db, sectionKey, items, t) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.builtin) {
      const fields = { label: it.label, position: i, hidden: !!it.hidden };
      const row = await db.ColumnPref.findOne({ where: { section_key: sectionKey, builtin_key: it.key }, transaction: t });
      if (row) await row.update(fields, { transaction: t });
      else await db.ColumnPref.create({ section_key: sectionKey, builtin_key: it.key, type: 'text', ...fields }, { transaction: t });
    } else {
      await db.ColumnPref.update({ label: it.label, position: i, hidden: !!it.hidden }, { where: { id: it.id, section_key: sectionKey }, transaction: t });
    }
  }
}

async function saveTiles(db, items, t) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.builtin) {
      const fields = { title: it.customTitle ? it.title : null, position: i, hidden: !!it.hidden };
      const row = await db.TilePref.findOne({ where: { key: it.key }, transaction: t });
      if (row) await row.update(fields, { transaction: t });
      else await db.TilePref.create({ key: it.key, ...fields }, { transaction: t });
    } else {
      await db.TilePref.update({ title: it.title, position: i, hidden: !!it.hidden }, { where: { id: it.id }, transaction: t });
    }
  }
}

const inTx = (db, fn) => db.sequelize.transaction(fn);

// ── Section mutations ───────────────────────────────────────────────────────
// Each returns { ok:true } or { ok:false, status, error }.

const fail = (status, error) => ({ ok: false, status, error });

/** Apply `change(item, items)` to one resolved item and persist. */
async function mutateSections(db, key, change) {
  const items = await loadSections(db);
  const idx = items.findIndex(i => i.key === key);
  if (idx === -1) return fail(404, 'no such section');
  const res = change(items[idx], items, idx);
  if (res && res.error) return fail(res.status || 400, res.error);
  const next = res && res.items ? res.items : items;
  await inTx(db, t => saveSections(db, next, t));
  return { ok: true };
}

const renameSection = (db, key, rawTitle) => {
  const blank = typeof rawTitle === 'string' && rawTitle.trim() === '';
  const title = L.cleanLabel(rawTitle);
  if (!title && !blank) return Promise.resolve(fail(400, 'title is required'));
  return mutateSections(db, key, it => {
    if (!title) { // blank on a built-in resets it; a custom section must keep a name
      if (!it.builtin) return { error: 'title is required' };
      it.title = it.defaultTitle; it.customTitle = false;
    } else { it.title = title; it.customTitle = true; }
  });
};
const moveSection   = (db, key, dir) => mutateSections(db, key, (it, items) => ({ items: L.moveItem(items, key, dir) }));
const hideSection   = (db, key, hidden) => mutateSections(db, key, it => { it.hidden = !!hidden; });

async function createCustomSection(db, rawTitle) {
  const title = L.cleanLabel(rawTitle) || 'New section';
  return inTx(db, async t => {
    const items = await loadSections(db);
    await saveSections(db, items, t); // materialise defaults so the new one lands last
    const sec = await db.CustomSection.create({ title, position: items.length, hidden: false }, { transaction: t });
    const key = L.customSectionKey(sec.id);
    await db.ColumnPref.create({ section_key: key, builtin_key: null, label: 'Name',   type: 'text',  position: 0, hidden: false }, { transaction: t });
    await db.ColumnPref.create({ section_key: key, builtin_key: null, label: 'Amount', type: 'money', position: 1, hidden: false }, { transaction: t });
    return { ok: true, id: sec.id, key };
  });
}

async function deleteCustomSection(db, key) {
  const id = L.parseCustomSectionKey(key);
  if (id === null) return fail(400, 'built-in sections can only be hidden, not deleted');
  const sec = await db.CustomSection.findByPk(id);
  if (!sec) return fail(404, 'no such section');
  await inTx(db, async t => {
    const cols = await db.ColumnPref.findAll({ where: { section_key: key }, transaction: t });
    const colIds = cols.map(c => c.id);
    if (colIds.length) {
      await db.CustomValue.destroy({ where: { column_id: colIds }, transaction: t });
      await db.TilePref.destroy({ where: { column_id: colIds }, transaction: t });
    }
    const rows = await db.CustomRow.findAll({ where: { section_id: id }, transaction: t });
    const rowIds = rows.map(r => r.id);
    if (rowIds.length && colIds.length) await db.CustomValue.destroy({ where: { row_id: rowIds, column_id: colIds }, transaction: t });
    await db.CustomRow.destroy({ where: { section_id: id }, transaction: t });
    await db.ColumnPref.destroy({ where: { section_key: key }, transaction: t });
    await sec.destroy({ transaction: t });
  });
  // close the gap in positions
  await inTx(db, async t => saveSections(db, await loadSections(db), t));
  return { ok: true };
}

// ── Column mutations ────────────────────────────────────────────────────────

async function mutateColumns(db, sectionKey, key, change) {
  if (!(await sectionExists(db, sectionKey))) return fail(404, 'no such section');
  if (L.isBuiltinSection(sectionKey) && !L.isTableSection(sectionKey)) return fail(400, 'this section has no columns');
  const items = await loadColumns(db, sectionKey);
  const idx = items.findIndex(i => i.key === key);
  if (idx === -1) return fail(404, 'no such column');
  const res = change(items[idx], items);
  if (res && res.error) return fail(res.status || 400, res.error);
  await inTx(db, t => saveColumns(db, sectionKey, (res && res.items) || items, t));
  return { ok: true };
}

const renameColumn = (db, sectionKey, key, rawLabel) => {
  const label = L.cleanLabel(rawLabel);
  if (!label) return Promise.resolve(fail(400, 'label is required'));
  return mutateColumns(db, sectionKey, key, it => { it.label = label; });
};
const moveColumn = (db, sectionKey, key, dir) =>
  mutateColumns(db, sectionKey, key, (it, items) => ({ items: L.moveItem(items, key, dir) }));
const hideColumn = (db, sectionKey, key, hidden) =>
  mutateColumns(db, sectionKey, key, it => { it.hidden = !!hidden; });

async function createCustomColumn(db, sectionKey, rawLabel, rawType) {
  if (!(await sectionExists(db, sectionKey))) return fail(404, 'no such section');
  if (L.isBuiltinSection(sectionKey) && !L.isTableSection(sectionKey)) return fail(400, 'this section has no columns');
  const label = L.cleanLabel(rawLabel);
  if (!label) return fail(400, 'label is required');
  const type = L.COLUMN_TYPES.includes(rawType) ? rawType : (rawType === undefined ? 'text' : null);
  if (!type) return fail(400, 'type must be one of ' + L.COLUMN_TYPES.join(', '));
  return inTx(db, async t => {
    const items = await loadColumns(db, sectionKey);
    await saveColumns(db, sectionKey, items, t); // materialise so the new column lands last
    const col = await db.ColumnPref.create(
      { section_key: sectionKey, builtin_key: null, label, type, position: items.length, hidden: false }, { transaction: t });
    return { ok: true, id: col.id, key: L.customColumnKey(col.id) };
  });
}

async function deleteCustomColumn(db, sectionKey, key) {
  const id = L.parseCustomColumnKey(key);
  if (id === null) return fail(400, 'built-in columns can only be hidden, not deleted');
  const col = await db.ColumnPref.findOne({ where: { id, section_key: sectionKey, builtin_key: null } });
  if (!col) return fail(404, 'no such column');
  await inTx(db, async t => {
    await db.CustomValue.destroy({ where: { column_id: id }, transaction: t });
    await db.TilePref.destroy({ where: { column_id: id }, transaction: t });
    await col.destroy({ transaction: t });
  });
  await inTx(db, async t => saveColumns(db, sectionKey, await loadColumns(db, sectionKey), t));
  return { ok: true };
}

// ── Tile mutations ──────────────────────────────────────────────────────────

async function mutateTiles(db, key, change) {
  const items = await loadTiles(db);
  const idx = items.findIndex(i => i.key === key);
  if (idx === -1) return fail(404, 'no such tile');
  const res = change(items[idx], items);
  if (res && res.error) return fail(res.status || 400, res.error);
  await inTx(db, t => saveTiles(db, (res && res.items) || items, t));
  return { ok: true };
}

const renameTile = (db, key, rawTitle) => {
  const blank = typeof rawTitle === 'string' && rawTitle.trim() === '';
  const title = L.cleanLabel(rawTitle);
  if (!title && !blank) return Promise.resolve(fail(400, 'title is required'));
  return mutateTiles(db, key, it => {
    if (!title) {
      if (!it.builtin) return { error: 'title is required' };
      it.title = it.defaultTitle; it.customTitle = false;
    } else { it.title = title; it.customTitle = true; }
  });
};
const moveTile = (db, key, dir) => mutateTiles(db, key, (it, items) => ({ items: L.moveItem(items, key, dir) }));
const hideTile = (db, key, hidden) => mutateTiles(db, key, it => { it.hidden = !!hidden; });

async function createCustomTile(db, rawTitle, columnId) {
  if (!Number.isInteger(columnId)) return fail(400, 'column_id must be an integer');
  const col = await db.ColumnPref.findOne({ where: { id: columnId, builtin_key: null } });
  if (!col) return fail(404, 'no such column');
  if (col.type !== 'number' && col.type !== 'money') return fail(400, 'a tile can only sum a number or money column');
  const title = L.cleanLabel(rawTitle) || col.label;
  return inTx(db, async t => {
    const items = await loadTiles(db);
    await saveTiles(db, items, t);
    const tile = await db.TilePref.create({ key: null, title, column_id: columnId, position: items.length, hidden: false }, { transaction: t });
    return { ok: true, id: tile.id, key: L.customTileKey(tile.id) };
  });
}

async function deleteCustomTile(db, key) {
  const id = L.parseCustomTileKey(key);
  if (id === null) return fail(400, 'built-in tiles can only be hidden, not deleted');
  const tile = await db.TilePref.findOne({ where: { id, key: null } });
  if (!tile) return fail(404, 'no such tile');
  await tile.destroy();
  await inTx(db, async t => saveTiles(db, await loadTiles(db), t));
  return { ok: true };
}

// ── Cells and rows ──────────────────────────────────────────────────────────

/**
 * Write (or clear) one cell. Validates, in order: the column is a user column,
 * the value fits its type, and the row really belongs to the column's section.
 */
async function setCellValue(db, columnId, rowId, raw) {
  if (!Number.isInteger(columnId) || columnId < 1) return fail(400, 'column_id must be an integer');
  if (!Number.isInteger(rowId) || rowId < 1) return fail(400, 'row_id must be an integer');
  const col = await db.ColumnPref.findByPk(columnId);
  if (!col || col.builtin_key) return fail(404, 'no such column');
  const parsed = L.parseCellValue(col.type, raw);
  if (!parsed.ok) return fail(400, parsed.error);
  if (!(await rowBelongsToSection(db, col.section_key, rowId))) return fail(404, 'no such row in this column\'s section');

  const where = { column_id: columnId, row_id: rowId };
  const existing = await db.CustomValue.findOne({ where });
  if (parsed.value === null) {
    if (existing) await existing.destroy();
  } else if (existing) {
    await existing.update({ value: parsed.value });
  } else {
    await db.CustomValue.create({ ...where, value: parsed.value });
  }
  return { ok: true, value: parsed.value, type: col.type, column: col };
}

/**
 * Save the extra inputs a built-in add form carries (fields named cv_<columnId>)
 * against the row just created. Invalid or foreign values are skipped, not
 * errors: this is a form post, and the row itself has already been saved.
 */
async function saveFormCustomValues(db, sectionKey, rowId, body) {
  if (!body || typeof body !== 'object') return;
  for (const name of Object.keys(body)) {
    const m = /^cv_(\d{1,12})$/.exec(name);
    if (!m) continue;
    const col = await db.ColumnPref.findByPk(Number(m[1]));
    if (!col || col.builtin_key || col.section_key !== sectionKey) continue;
    await setCellValue(db, col.id, rowId, body[name]);
  }
}

/** A built-in row was deleted: take its cells with it. */
async function deleteRowValues(db, sectionKey, rowId) {
  const cols = await db.ColumnPref.findAll({ where: { section_key: sectionKey, builtin_key: null } });
  if (!cols.length) return;
  await db.CustomValue.destroy({ where: { row_id: rowId, column_id: cols.map(c => c.id) } });
}

async function createCustomRow(db, sectionId) {
  const key = L.customSectionKey(sectionId);
  if (!Number.isInteger(sectionId) || !(await db.CustomSection.findByPk(sectionId))) return fail(404, 'no such section');
  const count = await db.CustomRow.count({ where: { section_id: sectionId } });
  const row = await db.CustomRow.create({ section_id: sectionId, position: count });
  return { ok: true, id: row.id, key };
}

async function deleteCustomRow(db, sectionId, rowId) {
  if (!(await rowBelongsToSection(db, L.customSectionKey(sectionId), rowId))) return fail(404, 'no such row');
  await inTx(db, async t => {
    await db.CustomValue.destroy({ where: { row_id: rowId }, transaction: t });
    await db.CustomRow.destroy({ where: { id: rowId }, transaction: t });
  });
  return { ok: true };
}

// ── Everything the dashboard needs ──────────────────────────────────────────

/** Totals of every custom tile, as { tileKey: text }, for one column (or all). */
async function customTileTexts(db, onlyColumnId) {
  const tiles = (await loadTiles(db)).filter(t => !t.builtin && (onlyColumnId == null || t.column_id === onlyColumnId));
  const out = {};
  for (const t of tiles) {
    const vals = plain(await db.CustomValue.findAll({ where: { column_id: t.column_id } })).map(v => v.value);
    out[t.key] = L.tileValue(t, null, { [t.column_id]: vals }).text;
  }
  return out;
}

/**
 * @param metrics { totalDebt, ..., subs: { subscriptionTotal: '3 subscriptions/month', ... } }
 */
async function buildLayout(db, metrics) {
  const [sections, tilesRaw, valueRows, allCols, customRowRows] = await Promise.all([
    loadSections(db),
    loadTiles(db),
    db.CustomValue.findAll().then(plain),
    db.ColumnPref.findAll().then(plain),
    db.CustomRow.findAll({ order: [['position', 'ASC'], ['id', 'ASC']] }).then(plain),
  ]);

  const colIds = new Set(allCols.filter(c => !c.builtin_key).map(c => c.id));
  const cv = {};            // cv[columnId][rowId] = stored string
  const valuesByColumn = {};
  for (const v of valueRows) {
    if (!colIds.has(v.column_id)) continue;
    (cv[v.column_id] = cv[v.column_id] || {})[v.row_id] = v.value;
    (valuesByColumn[v.column_id] = valuesByColumn[v.column_id] || []).push(v.value);
  }

  const customRows = {};    // customRows[sectionId] = [{ id }]
  for (const r of customRowRows) (customRows[r.section_id] = customRows[r.section_id] || []).push({ id: r.id });

  for (const s of sections) {
    s.columns = s.table ? L.resolveColumns(s.key, allCols) : [];
  }

  const subs = (metrics && metrics.subs) || {};
  const tiles = tilesRaw.map(t => {
    const v = L.tileValue(t, metrics, valuesByColumn);
    return { ...t, text: v.text, sub: t.builtin ? (subs[t.key] || '') : '' };
  });

  // Columns a custom tile may sum: user number/money columns in any live section.
  const sumColumns = [];
  for (const s of sections) {
    for (const c of s.columns) {
      if (!c.builtin && (c.type === 'number' || c.type === 'money')) {
        sumColumns.push({ id: c.id, label: `${s.title} — ${c.label}`, type: c.type });
      }
    }
  }

  return { sections, tiles, cv, customRows, sumColumns };
}

module.exports = {
  SECTION_MODEL,
  sectionExists, rowBelongsToSection,
  loadSections, loadColumns, loadTiles,
  renameSection, moveSection, hideSection, createCustomSection, deleteCustomSection,
  renameColumn, moveColumn, hideColumn, createCustomColumn, deleteCustomColumn,
  renameTile, moveTile, hideTile, createCustomTile, deleteCustomTile,
  setCellValue, saveFormCustomValues, deleteRowValues, createCustomRow, deleteCustomRow,
  customTileTexts, buildLayout,
};
