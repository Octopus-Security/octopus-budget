'use strict';

/**
 * appAccess.js — may THIS signed-in account use THIS app?
 *
 * octopus-auth owns the answer (per-user override, then a runtime default, then
 * the shipped default) and exposes it at GET /api/auth/apps/:slug/allowed. This
 * is the enforcing half: without it, taking a tile off someone's hub only hides
 * it, and the app stays reachable by URL. That is what makes a paid app worth
 * paying for, so it is a gate and not a courtesy.
 *
 * An admin always passes (auth says so), and with no rows in auth's tables the
 * answer is "allowed" for everyone, so wiring this in changes nothing until the
 * owner changes a default or a billing event writes a denial.
 *
 * FAILURE MODE. Unreachable auth keeps serving the LAST answer for that user
 * even when it is stale, and with no previous answer fails OPEN. The request has
 * already proved a valid estate session; the only thing an auth outage can cost
 * is a revocation landing late, whereas failing closed would lock every paying
 * customer out of what they paid for during a blip. A revocation lands within
 * CACHE_TTL_MS when auth is up.
 *
 * A 404 from auth means the slug is not in its catalogue — a configuration error
 * here, not a denial there — so it allows and says so loudly.
 */

const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE = 5000;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function createAppGate({ authUrl, slug, upgradeUrl = '', appName = 'this app', fetchImpl, now = Date.now } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const cache = new Map();           // username → { allowed, at }

  async function allowed(req) {
    const key = req.user && req.user.username;
    const hit = key && cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.allowed;

    // Ask AS the user: forward whichever credential arrived instead of parsing it.
    const headers = {};
    if (req.get('cookie')) headers.Cookie = req.get('cookie');
    if (req.get('authorization')) headers.Authorization = req.get('authorization');

    try {
      const res = await doFetch(`${authUrl}/api/auth/apps/${encodeURIComponent(slug)}/allowed`, { headers });
      if (res.status === 404) {
        console.warn(`[access] "${slug}" is not an app octopus-auth knows — the gate is doing nothing. Check hub-apps.json.`);
        return true;
      }
      if (!res.ok) throw new Error(`auth answered ${res.status}`);
      const body = await res.json();
      const ok = body.allowed !== false;
      if (key) {
        if (cache.size >= MAX_CACHE) cache.clear();
        cache.set(key, { allowed: ok, at: now() });
      }
      return ok;
    } catch (err) {
      console.warn(`[access] could not check "${slug}" access (${err.message}) — ${hit ? 'using the last answer' : 'allowing'}`);
      return hit ? hit.allowed : true;
    }
  }

  // Express middleware. Run it AFTER the login check, so req.user is set.
  async function appGate(req, res, next) {
    try {
      if (!slug) return next();
      if (await allowed(req)) return next();
    } catch (err) {
      return next(err);
    }
    const message = `Your account does not include ${appName}.`;
    if ((req.originalUrl || req.url || '').startsWith('/api/')) {
      return res.status(403).json({ error: message, code: 'no_access', upgradeUrl: upgradeUrl || null });
    }
    const link = upgradeUrl
      ? `<p><a href="${escapeHtml(upgradeUrl)}">See plans</a></p>`
      : '';
    res.status(403).type('html').send(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<title>No access</title>`
      + `<body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem">`
      + `<h1 style="font-size:1.4rem">No access yet</h1><p>${escapeHtml(message)}</p>${link}`
      + `<p><a href="/">Back</a></p></body>`);
  }
  // What /api/build reports as `gate`: the slug this gate was actually built
  // with (null when it is a pass-through), never a separately typed constant.
  appGate.slug = slug || null;
  return appGate;
}

module.exports = { createAppGate, CACHE_TTL_MS };
