'use strict';
/**
 * Themed dialogs from octopus-kit (ui/dialog.js + ui/dialog.css), replacing the
 * browser's native alert/confirm/prompt. Served at /_kit/ with a content stamp
 * (?v=<hash>) like every other asset here, so a kit bump is never hidden by
 * Cloudflare's four-hour cache. `kitDialogHead` is a ready-made <link>+<script>
 * pair for the page <head>; the script is classic (not deferred) so
 * `window.oDialog` exists before any inline script runs.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'node_modules', 'octopus-kit', 'ui');
const FILES = { 'dialog.js': 'application/javascript; charset=utf-8', 'dialog.css': 'text/css; charset=utf-8' };

function stamp(name) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, name))).digest('hex').slice(0, 8); }
  catch { return 'missing'; }
}

function mountKitDialog(app) {
  const v = { 'dialog.js': stamp('dialog.js'), 'dialog.css': stamp('dialog.css') };
  app.locals.kitDialogHead =
    `<link rel="stylesheet" href="/_kit/dialog.css?v=${v['dialog.css']}">\n` +
    `<script src="/_kit/dialog.js?v=${v['dialog.js']}"></script>`;
  app.get('/_kit/:file', (req, res) => {
    const type = FILES[req.params.file];
    if (!type) return res.status(404).end();
    let body;
    try { body = fs.readFileSync(path.join(DIR, req.params.file)); } catch { return res.status(404).end(); }
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(body);
  });
}

module.exports = { mountKitDialog, DIR };
