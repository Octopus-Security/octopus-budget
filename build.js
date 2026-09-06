'use strict';
/**
 * build.js — one string identifying the code this container is running.
 *
 * Portainer polls and deploys on its own; nothing reports back. Without an
 * endpoint that moves when the code moves, a deploy that never landed and one
 * that landed without helping look identical from outside — octopus-science
 * lost three rounds of bug reports to exactly that.
 *
 * ── Derived, not a pasted constant ───────────────────────────────────────────
 * octopus-ee and octopus-science keep `const BUILD = '…'` because their browser
 * code carries the same literal and the comparison needs one. This service has
 * no such client and needs the opposite property: a stamp you must remember to
 * bump reports "nothing changed" for a deploy that did, the first time anyone
 * forgets. That is a check failing quietly toward "everything is fine", which
 * is the shape this estate keeps getting caught by. So it is computed at
 * startup and cannot drift.
 *
 * ── What it covers ───────────────────────────────────────────────────────────
 * Everything that ships except dependencies and live data, found by WALKING the
 * directory rather than from a list here. A written list stops covering the
 * file just added, and that failure is silent in the worst way: the guard goes
 * quiet exactly for the newest code.
 *
 * That deliberately includes views/ and public/ — a fixed template or
 * stylesheet is exactly the kind of change you want to confirm landed — and it
 * includes api/, the legacy scaffold index.js never requires. The question this
 * answers is "is the running image the code I pushed", and by that question a
 * changed file counts whether or not a request reaches it.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ROOT = __dirname;

// Dependencies are pinned by the lockfile and reinstalled per build; `data` is
// the live per-user databases and changes constantly, which would make the
// stamp move for reasons that are not deploys.
const SKIP_DIRS = new Set(['node_modules', '.git', 'data']);
const KEEP_EXT  = new Set(['.js', '.json', '.ejs', '.css', '.html', '.mjs']);
const SKIP_FILES = new Set(['package-lock.json']);

function sourceFiles(dir = ROOT, prefix = '') {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  // Sorted explicitly: readdir order is not promised, and a hash depending on
  // it would differ between this laptop and the image.
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
        out.push(...sourceFiles(path.join(dir, e.name), rel));
      }
    } else if (KEEP_EXT.has(path.extname(e.name)) && !SKIP_FILES.has(e.name)) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * A stamp must never be the reason this service fails to boot, so every step is
 * guarded and the fallback is 'unknown' — deliberately not hash-shaped, so it
 * cannot be misread as a value. `unknown` is never `current`.
 */
function computeBuild() {
  try {
    const files = sourceFiles();
    if (!files.length) return 'unknown';
    const h = crypto.createHash('sha256');
    for (const f of files) {
      let src;
      try { src = fs.readFileSync(path.join(ROOT, f)); } catch { continue; }
      h.update(f);
      h.update(src);
    }
    return h.digest('hex').slice(0, 12);
  } catch {
    return 'unknown';
  }
}

const BUILD      = computeBuild();
const STARTED_AT = new Date().toISOString();

/**
 * ─── Cache-busting for the client assets ──────────────────────────────────────
 *
 * Cloudflare caches CSS and JS for four hours and OVERRIDES the origin's
 * Cache-Control, so a shipped front-end fix is invisible for that long and looks
 * exactly like a deploy that failed. On 2026-09-05 a menu fix on the public site
 * was correct, deployed, verified in a browser — and still broken for the person
 * looking at it, because they were being served August's stylesheet
 * (`cf-cache-status: HIT`, `age: 1332`). octopus-science lost three rounds of bug
 * reports to the same thing.
 *
 * `/theme.css?v=ab12cd34` is a different URL, so it is fetched fresh the moment
 * it is deployed. No purge, no API token, nothing to remember.
 *
 * ── Per file, not per build ──────────────────────────────────────────────────
 * The stamp is a hash of THAT FILE's content, not BUILD. BUILD moves whenever
 * any server file changes, which would re-download every asset on every deploy
 * and throw away caching that is doing its job. A per-file hash changes when and
 * only when that asset does.
 *
 * ── Read once at startup ─────────────────────────────────────────────────────
 * The files are immutable for the life of the container — the image is rebuilt
 * to change them — so hashing on each render would be pure cost. An asset that
 * cannot be read returns the bare path rather than throwing: a missing stamp is
 * a stale cache, a thrown error is a blank page.
 */
const ASSET_STAMPS = new Map();

function asset(urlPath) {
  if (!ASSET_STAMPS.has(urlPath)) {
    let stamp = null;
    try {
      const file = path.join(ROOT, 'public', urlPath.replace(/^\/+/, '').split('?')[0]);
      stamp = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
    } catch { /* not on disk — serve it unstamped rather than failing the render */ }
    ASSET_STAMPS.set(urlPath, stamp ? `${urlPath}?v=${stamp}` : urlPath);
  }
  return ASSET_STAMPS.get(urlPath);
}

module.exports = { BUILD, STARTED_AT, sourceFiles, asset };
