/*
 * Keep the scroll position across the dashboard's POST -> redirect('/') round
 * trips (add, delete, mark paid, edit), which would otherwise land at the top.
 *
 * The position is stored in sessionStorage as { y, t } the moment a navigation
 * actually proceeds, and consumed by the next dashboard load. It carries a
 * timestamp and is ignored once it is older than MAX_AGE_MS, so a value left
 * behind by a navigation that never completed (or a visit abandoned on the edit
 * page) cannot fire on some later, unrelated load.
 *
 * Pages declare their role with <body data-scroll="dashboard"> or
 * data-scroll="edit". An edit page does not record a position of its own; it
 * only refreshes the timestamp of the dashboard's stored one when the user
 * leaves it (save, cancel, or a link back), so a slow edit still round-trips.
 */
(function () {
  'use strict';
  var KEY = 'budget:scrollY';
  var MAX_AGE_MS = 30000;

  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) { /* ignore */ }

  function read() {
    try {
      var raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.y !== 'number' || typeof o.t !== 'number') return null;
      return o;
    } catch (e) { return null; }
  }
  function write(y, t) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ y: y, t: t })); } catch (e) { /* ignore */ }
  }
  function clear() {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  var role = (document.body && document.body.getAttribute('data-scroll')) || '';
  // Role is read lazily below too: this script may run in <head> before <body>.
  function currentRole() {
    return (document.body && document.body.getAttribute('data-scroll')) || role;
  }

  // Record where we are (dashboard) or keep the stored position alive (edit page).
  function remember() {
    if (currentRole() === 'edit') {
      var o = read();
      if (o) write(o.y, Date.now());
    } else if (currentRole() === 'dashboard') {
      write(Math.round(window.pageYOffset || document.documentElement.scrollTop || 0), Date.now());
    }
  }
  window.budgetSaveScroll = remember;

  function sameOriginNav(a) {
    if (!a || !a.href) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    var u;
    try { u = new URL(a.href, location.href); } catch (e) { return false; }
    if (u.origin !== location.origin) return false;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return false; // in-page anchor
    return true;
  }

  // Both listeners run in the bubble phase on purpose: an inline
  // onclick="return confirm(...)" that returns false has already called
  // preventDefault by then, so a declined confirm never records anything.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (sameOriginNav(a)) remember();
  });
  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    remember();
  });

  function restore() {
    if (currentRole() !== 'dashboard') return;
    var o = read();
    if (!o) return;
    clear();
    if (Date.now() - o.t > MAX_AGE_MS) return;
    var target = o.y;
    window.scrollTo(0, target);
    // Late layout (images, fonts) can shift the page after DOMContentLoaded; re-apply
    // once on load unless the person has already started scrolling themselves.
    var touched = false;
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (ev) {
      window.addEventListener(ev, function () { touched = true; }, { passive: true, once: true });
    });
    window.addEventListener('load', function () {
      if (!touched && Math.abs((window.pageYOffset || 0) - target) > 2) window.scrollTo(0, target);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restore);
  else restore();
})();
