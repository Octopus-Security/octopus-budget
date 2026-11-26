'use strict';

/**
 * Refuse a link that changes data when it was followed from another site.
 *
 * Several delete / mark-paid actions are plain GET links (views/index.ejs). The sign-in cookie is
 * SameSite=Lax, which the browser sends on a top-level navigation from anywhere, so a page on
 * another site could send a signed-in visitor through one of those links. Browsers say where a
 * request came from in `Sec-Fetch-Site`; a click inside this app is `same-origin`, a typed or
 * bookmarked address is `none`. Anything else is refused. A browser that sends no such header falls
 * back to the Referer, refusing only when one is present and names another host.
 *
 * This is the stop-gap; the proper fix is to make these POST forms (the data-confirm helper already
 * handles forms), after which this guard can go.
 */
const CHANGES_DATA = /^\/(subscriptions|accounts|debts|providers|installments|transactions)\/(delete|paid)\//;

function refuseCrossSiteChange(req, res, next) {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || !CHANGES_DATA.test(req.path)) return next();
  const site = req.get('sec-fetch-site');
  let ok;
  if (site) {
    ok = site === 'same-origin' || site === 'none';
  } else {
    const ref = req.get('referer');
    ok = true;
    if (ref) { try { ok = new URL(ref).host === req.get('host'); } catch { ok = false; } }
  }
  if (ok) return next();
  return res.status(403).type('text/plain').send('Open this page from the app to do that.');
}

module.exports = { refuseCrossSiteChange, CHANGES_DATA };
