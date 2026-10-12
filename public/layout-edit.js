/*
 * Customizable dashboard: edit mode, layout mutations and inline cell editing.
 *
 * - Edit mode shows every `.edit-only` element (hidden inline by default, so it
 *   works even with a stale stylesheet) and is remembered across the reload that
 *   follows a layout change.
 * - Layout changes (rename/move/hide/add/delete) POST JSON, then reload; the
 *   scroll position is stored first (scroll.js) so the reload lands where it was.
 * - Cell edits and custom-row add/delete update the DOM in place, no reload.
 *
 * All text is written with textContent/value, never innerHTML.
 */
(function () {
  'use strict';
  var EDIT_KEY = 'budget:layoutEdit';

  function store(get, key, val) {
    try {
      if (get) return sessionStorage.getItem(key);
      if (val === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, val);
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function toast(msg) {
    var t = document.getElementById('layoutToast');
    if (!t) { t = document.createElement('div'); t.id = 'layoutToast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.style.display = 'none'; }, 4000);
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || ('request failed (' + r.status + ')'));
        return j;
      });
    });
  }

  function reload() {
    if (window.budgetSaveScroll) window.budgetSaveScroll();
    location.reload();
  }

  function run(promise) { return promise.then(reload, function (e) { toast(e.message); }); }

  function updateTiles(tiles) {
    if (!tiles) return;
    Object.keys(tiles).forEach(function (key) {
      document.querySelectorAll('[data-tile]').forEach(function (el) {
        if (el.getAttribute('data-tile') !== key) return;
        var amt = el.querySelector('.amount');
        if (amt) amt.textContent = tiles[key];
      });
    });
  }

  // ── edit mode ─────────────────────────────────────────────────────────────
  function setEdit(on) {
    document.querySelectorAll('.edit-only').forEach(function (el) {
      el.style.display = on ? (el.getAttribute('data-display') || 'block') : 'none';
    });
    var btn = document.getElementById('layoutToggle');
    if (btn) btn.textContent = on ? '✓ Done customizing' : '✏️ Customize';
    store(false, EDIT_KEY, on ? '1' : null);
  }

  // ── click actions ─────────────────────────────────────────────────────────
  var actions = {
    'section-move':   function (d) { return post('/layout/sections/move', { key: d.key, dir: Number(d.dir) }); },
    'section-hide':   function (d) { return post('/layout/sections/hide', { key: d.key, hidden: d.hidden === '1' }); },
    'section-delete': function (d) { return post('/layout/sections/delete', { key: d.key }); },
    'section-add': function () {
      var el = document.getElementById('newSectionTitle');
      return post('/layout/sections', { title: el ? el.value : '' });
    },
    'col-move':   function (d) { return post('/layout/columns/move', { section_key: d.section, key: d.key, dir: Number(d.dir) }); },
    'col-hide':   function (d) { return post('/layout/columns/hide', { section_key: d.section, key: d.key, hidden: d.hidden === '1' }); },
    'col-delete': function (d) { return post('/layout/columns/delete', { section_key: d.section, key: d.key }); },
    'col-add': function (d) {
      var label = document.querySelector('[data-newcol-label="' + d.section + '"]');
      var type = document.querySelector('[data-newcol-type="' + d.section + '"]');
      if (!label || !label.value.trim()) { toast('Give the column a name'); return null; }
      return post('/layout/columns', { section_key: d.section, label: label.value, type: type ? type.value : 'text' });
    },
    'tile-move':   function (d) { return post('/layout/tiles/move', { key: d.key, dir: Number(d.dir) }); },
    'tile-hide':   function (d) { return post('/layout/tiles/hide', { key: d.key, hidden: d.hidden === '1' }); },
    'tile-delete': function (d) { return post('/layout/tiles/delete', { key: d.key }); },
    'tile-add': function () {
      var title = document.getElementById('newTileTitle');
      var col = document.getElementById('newTileColumn');
      if (!col) return null;
      return post('/layout/tiles', { title: title ? title.value : '', column_id: Number(col.value) });
    }
  };

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    if (t.closest('#layoutToggle')) {
      var on = document.querySelector('.edit-only') && document.querySelector('.edit-only').style.display === 'none';
      setEdit(!!on);
      return;
    }

    var btn = t.closest('button[data-act]');
    if (btn) {
      var d = btn.dataset;
      if (d.act === 'row-add') { addRow(btn); return; }
      if (d.act === 'row-delete') { deleteRow(btn); return; }
      var fn = actions[d.act];
      if (!fn) return;
      if (d.confirm && !confirm(d.confirm)) return;
      var p = fn(d);
      if (p) run(p);
      return;
    }

    var td = t.closest('td.cv-cell');
    if (td && !td.querySelector('input')) startEdit(td);
  });

  // ── renames: a text input with data-act fires "change" on blur / Enter ────
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var act = el.getAttribute('data-act');
    var p = null;
    if (act === 'section-rename') p = post('/layout/sections/rename', { key: el.dataset.key, title: el.value });
    else if (act === 'col-rename') p = post('/layout/columns/rename', { section_key: el.dataset.section, key: el.dataset.key, label: el.value });
    else if (act === 'tile-rename') p = post('/layout/tiles/rename', { key: el.dataset.key, title: el.value });
    if (p) run(p);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('lay-input') &&
        e.target.tagName === 'INPUT') {
      var a = e.target.getAttribute('data-act');
      if (a) { e.preventDefault(); e.target.blur(); }
    }
  });

  // ── inline cell editing (no reload) ───────────────────────────────────────
  function showCell(td, raw) {
    td.textContent = '';
    td.dataset.raw = raw || '';
    if (!raw) {
      var s = document.createElement('span');
      s.className = 'cv-empty'; s.style.color = '#444'; s.textContent = '—';
      td.appendChild(s);
      return;
    }
    var shown = raw;
    if (td.dataset.type === 'money' && isFinite(Number(raw))) shown = '$' + Number(raw).toFixed(2);
    td.textContent = shown;
  }

  function startEdit(td) {
    var type = td.dataset.type;
    var raw = td.dataset.raw || '';
    var input = document.createElement('input');
    input.type = type === 'date' ? 'date' : 'text';
    if (type === 'number' || type === 'money') input.setAttribute('inputmode', 'decimal');
    if (type === 'text') input.maxLength = 200;
    input.value = raw;
    input.className = 'lay-input';
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    var done = false;

    function finish(save) {
      if (done) return;
      done = true;
      if (!save || input.value.trim() === raw) { showCell(td, raw); return; }
      post('/custom/values', { column_id: Number(td.dataset.col), row_id: Number(td.dataset.row), value: input.value })
        .then(function (j) {
          showCell(td, j.value == null ? '' : String(j.value));
          td.style.outline = '1px solid #2a6a3a';
          setTimeout(function () { td.style.outline = ''; }, 900);
          updateTiles(j.tiles);
        }, function (err) {
          showCell(td, raw);
          td.style.outline = '1px solid #e55';
          setTimeout(function () { td.style.outline = ''; }, 2500);
          toast('Could not save: ' + err.message);
        });
    }
    input.addEventListener('blur', function () { finish(true); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  // ── custom rows (DOM updated in place) ────────────────────────────────────
  function sectionTable(sectionId) {
    return document.querySelector('table[data-section-table="custom:' + sectionId + '"]');
  }

  function addRow(btn) {
    var sid = Number(btn.dataset.sectionId);
    var table = sectionTable(sid);
    if (!table) return;
    post('/custom/rows', { section_id: sid }).then(function (j) {
      var tr = document.createElement('tr');
      tr.setAttribute('data-row-id', String(j.id));
      Array.prototype.forEach.call(table.rows[0].cells, function (th) {
        var td = document.createElement('td');
        if (th.getAttribute('data-actions')) {
          td.className = 'actions';
          var b = document.createElement('button');
          b.type = 'button'; b.className = 'delete-btn'; b.textContent = 'Delete'; b.style.cursor = 'pointer';
          b.setAttribute('data-act', 'row-delete');
          b.setAttribute('data-section-id', String(sid));
          b.setAttribute('data-row-id', String(j.id));
          td.appendChild(b);
        } else {
          td.className = 'cv-cell';
          td.dataset.col = th.getAttribute('data-col-id');
          td.dataset.row = String(j.id);
          td.dataset.type = th.getAttribute('data-type');
          td.title = 'Click to edit';
          td.style.cursor = 'text';
          showCell(td, '');
        }
        tr.appendChild(td);
      });
      (table.tBodies[0] || table).appendChild(tr);
      var msg = table.parentNode.querySelector('.cv-empty-msg');
      if (msg) msg.style.display = 'none';
      var first = tr.querySelector('td.cv-cell');
      if (first) startEdit(first);
    }, function (err) { toast(err.message); });
  }

  function deleteRow(btn) {
    if (!confirm('Delete this row?')) return;
    var sid = Number(btn.dataset.sectionId), rid = Number(btn.dataset.rowId);
    post('/custom/rows/delete', { section_id: sid, row_id: rid }).then(function (j) {
      var tr = btn.closest('tr');
      var table = sectionTable(sid);
      if (tr) tr.parentNode.removeChild(tr);
      if (table && table.querySelectorAll('tr[data-row-id]').length === 0) {
        var msg = table.parentNode.querySelector('.cv-empty-msg');
        if (msg) msg.style.display = '';
      }
      updateTiles(j.tiles);
    }, function (err) { toast(err.message); });
  }

  // ── init ──────────────────────────────────────────────────────────────────
  function init() { if (store(true, EDIT_KEY) === '1') setEdit(true); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
