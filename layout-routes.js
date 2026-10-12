'use strict';

/**
 * JSON routes for the customizable dashboard: /layout/... (sections, columns,
 * tiles) and /custom/... (rows and cells of user-made columns).
 *
 * Every route sits behind requireLogin and works on req.user's own database, so
 * nothing here needs an owner column. All validation that is about DATA (does
 * this row belong to that column's section?) lives in layout-store.js; this file
 * only checks the shape of the request.
 */

const S = require('./layout-store');

const toInt = v => (typeof v === 'number' && Number.isInteger(v)) ? v
  : (typeof v === 'string' && /^\d{1,12}$/.test(v)) ? Number(v) : null;
const str = v => (typeof v === 'string' ? v : null);

module.exports = function registerLayoutRoutes(app, requireLogin, getDatabase) {
  const route = (path, handler) => app.post(path, requireLogin, async (req, res) => {
    try {
      const db = getDatabase(req.user.username);
      const r = await handler(db, req.body && typeof req.body === 'object' ? req.body : {});
      if (!r.ok) return res.status(r.status || 400).json({ ok: false, error: r.error });
      const { status, ...out } = r;
      res.json(out);
    } catch (e) {
      console.error(`${path} failed:`, e.message);
      res.status(500).json({ ok: false, error: 'server error' });
    }
  });
  const bad = error => ({ ok: false, status: 400, error });
  const dirOf = b => (Number(b.dir) === -1 ? -1 : Number(b.dir) === 1 ? 1 : null);
  const hiddenOf = b => (typeof b.hidden === 'boolean' ? b.hidden : null);

  // ── Sections ──────────────────────────────────────────────────────────────
  route('/layout/sections', (db, b) => S.createCustomSection(db, str(b.title)));
  route('/layout/sections/rename', (db, b) =>
    str(b.key) && str(b.title) !== null ? S.renameSection(db, b.key, b.title) : bad('key and title are required'));
  route('/layout/sections/move', (db, b) =>
    str(b.key) && dirOf(b) ? S.moveSection(db, b.key, dirOf(b)) : bad('key and dir (-1 or 1) are required'));
  route('/layout/sections/hide', (db, b) =>
    str(b.key) && hiddenOf(b) !== null ? S.hideSection(db, b.key, hiddenOf(b)) : bad('key and hidden (boolean) are required'));
  route('/layout/sections/delete', (db, b) =>
    str(b.key) ? S.deleteCustomSection(db, b.key) : bad('key is required'));

  // ── Columns ───────────────────────────────────────────────────────────────
  route('/layout/columns', (db, b) =>
    str(b.section_key) ? S.createCustomColumn(db, b.section_key, b.label, b.type === undefined ? undefined : str(b.type) || '')
                       : bad('section_key is required'));
  route('/layout/columns/rename', (db, b) =>
    str(b.section_key) && str(b.key) ? S.renameColumn(db, b.section_key, b.key, b.label) : bad('section_key, key and label are required'));
  route('/layout/columns/move', (db, b) =>
    str(b.section_key) && str(b.key) && dirOf(b) ? S.moveColumn(db, b.section_key, b.key, dirOf(b)) : bad('section_key, key and dir are required'));
  route('/layout/columns/hide', (db, b) =>
    str(b.section_key) && str(b.key) && hiddenOf(b) !== null ? S.hideColumn(db, b.section_key, b.key, hiddenOf(b)) : bad('section_key, key and hidden are required'));
  route('/layout/columns/delete', (db, b) =>
    str(b.section_key) && str(b.key) ? S.deleteCustomColumn(db, b.section_key, b.key) : bad('section_key and key are required'));

  // ── Tiles ─────────────────────────────────────────────────────────────────
  route('/layout/tiles', (db, b) => {
    const col = toInt(b.column_id);
    return col === null ? bad('column_id is required') : S.createCustomTile(db, str(b.title), col);
  });
  route('/layout/tiles/rename', (db, b) =>
    str(b.key) && str(b.title) !== null ? S.renameTile(db, b.key, b.title) : bad('key and title are required'));
  route('/layout/tiles/move', (db, b) =>
    str(b.key) && dirOf(b) ? S.moveTile(db, b.key, dirOf(b)) : bad('key and dir (-1 or 1) are required'));
  route('/layout/tiles/hide', (db, b) =>
    str(b.key) && hiddenOf(b) !== null ? S.hideTile(db, b.key, hiddenOf(b)) : bad('key and hidden (boolean) are required'));
  route('/layout/tiles/delete', (db, b) =>
    str(b.key) ? S.deleteCustomTile(db, b.key) : bad('key is required'));

  // ── Custom rows and cells ─────────────────────────────────────────────────
  route('/custom/rows', (db, b) => {
    const id = toInt(b.section_id);
    return id === null ? bad('section_id is required') : S.createCustomRow(db, id);
  });
  route('/custom/rows/delete', async (db, b) => {
    const sid = toInt(b.section_id), rid = toInt(b.row_id);
    if (sid === null || rid === null) return bad('section_id and row_id are required');
    const r = await S.deleteCustomRow(db, sid, rid);
    return r.ok ? { ok: true, tiles: await S.customTileTexts(db) } : r;
  });
  route('/custom/values', async (db, b) => {
    const col = toInt(b.column_id), row = toInt(b.row_id);
    if (col === null || row === null) return bad('column_id and row_id are required');
    const r = await S.setCellValue(db, col, row, b.value);
    if (!r.ok) return r;
    // Custom tiles that sum this column change with it; send their new text so
    // the page can update without a reload.
    return { ok: true, value: r.value, type: r.type, tiles: await S.customTileTexts(db, col) };
  });
};
