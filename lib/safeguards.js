'use strict';
/**
 * safeguards — the mechanical half of the HIPAA technical safeguards (45 CFR 164.312), for any app
 * that holds a person's health or client data. Zero dependencies; Express is PASSED IN by the app,
 * never required here. Map and status per app: octopus-vault/compliance/HIPAA.md.
 *
 *   secureHeaders()  response headers: nosniff, no framing, HSTS on https, no referrer leak, CSP that
 *                    only locks down framing/base/forms/objects (it does NOT restrict scripts, so an
 *                    inline theme-boot tag keeps working). `noStore` adds Cache-Control: no-store.
 *   idleTimeout()    automatic logoff (164.312(a)(2)(iii)): a signed, HttpOnly "last seen" cookie; a
 *                    request more than `idleMs` after the previous one is refused via `onExpire`.
 *   safeError()      an error as a log line WITHOUT its message. Database and validation errors quote
 *                    the offending value, which for these apps is client data.
 *   auditLine()      one JSON log line for "who did what to which record", content never included.
 *
 * What this does not do: encrypt anything, or decide who may see a record. Those stay with the app.
 */

const crypto = require('crypto');

function secureHeaders({ noStore = false, hsts = true, frame = 'DENY', referrer = 'same-origin', csp = true } = {}) {
  const policy = csp === true
    ? "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
    : (csp || '');
  return function secureHeadersMiddleware(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', frame);
    res.setHeader('Referrer-Policy', referrer);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (policy) res.setHeader('Content-Security-Policy', policy);
    if (hsts && req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    if (noStore) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

function readCookie(header, name) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * Place AFTER the middleware that sets req.user and BEFORE the routes. `secret` should come from the
 * environment; without one a random per-process secret is used, so a restart invalidates every
 * "last seen" cookie and each person simply starts a fresh window (it never extends an old one).
 * A request with no valid cookie starts a window: this bounds an UNATTENDED browser, which is the
 * case the rule names. It is not a defence against someone who already holds the session.
 */
function idleTimeout({
  idleMs = 15 * 60 * 1000, secret, cookie = 'o_idle', now = Date.now, refreshMs = 30 * 1000,
  userOf = req => req.user && req.user.username, onExpire,
} = {}) {
  const key = secret || crypto.randomBytes(32).toString('hex');
  const sign = (user, ts) => crypto.createHmac('sha256', key).update(`${user}\n${ts}`).digest('base64url');
  const clear = (req, res) => res.append('Set-Cookie', `${cookie}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  const stamp = (req, res, user, t) => res.append('Set-Cookie',
    `${cookie}=${t}.${sign(user, t)}; Path=/; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  return function idleTimeoutMiddleware(req, res, next) {
    const user = userOf(req);
    if (!user) return next();
    const t = now();
    const raw = readCookie(req.headers.cookie, cookie);
    if (raw) {
      const [ts, mac] = raw.split('.');
      const last = Number(ts);
      const good = Number.isFinite(last) && mac && mac.length === sign(user, ts).length
        && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(user, ts)));
      if (good) {
        if (t - last > idleMs) {
          clear(req, res);
          return onExpire ? onExpire(req, res, next) : res.status(401).end();
        }
        if (t - last > refreshMs) stamp(req, res, user, t);
        return next();
      }
    }
    stamp(req, res, user, t);
    return next();
  };
}

/** `Name CODE` plus the stack frames, with the message (and so any quoted value) removed. */
function safeError(err) {
  if (!err || typeof err !== 'object') return 'non-error thrown';
  const head = `${err.name || 'Error'}${err.code ? ` ${String(err.code).slice(0, 40)}` : ''}`;
  const frames = String(err.stack || '').split('\n').filter(l => /^\s+at /.test(l)).slice(0, 8);
  return [head, ...frames].join('\n');
}

/** { at, actor, action, target, ok } as one line. `target` is an id or hash, never content. */
function auditLine({ actor, action, target = null, ok = true }, log = console.log, now = Date.now) {
  log(`[audit] ${JSON.stringify({ at: new Date(now()).toISOString(), actor, action, target, ok })}`);
}

/**
 * `Cache-Control: no-store` on any answer to a request that carries a session (the SSO cookie or a
 * Bearer token) and did not set its own Cache-Control. Applied when the headers are written, so a
 * static file or a deliberately cacheable page that sets its own policy keeps it: caching of
 * versioned assets is unaffected, and a signed-in HTML or JSON answer is never kept by a shared
 * cache or the back button. (Added by the 2026-11-12 sweep; not in octopus-kit yet.)
 */
function noStoreWhenSignedIn({ cookie = 'octopus_sso' } = {}) {
  return function noStoreWhenSignedInMiddleware(req, res, next) {
    const signedIn = readCookie(req.headers.cookie, cookie) !== null || /^Bearer\s/i.test(req.headers.authorization || '');
    if (signedIn) {
      const writeHead = res.writeHead;
      res.writeHead = function patchedWriteHead(...args) {
        if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
        return writeHead.apply(this, args);
      };
    }
    next();
  };
}

module.exports = { secureHeaders, idleTimeout, safeError, auditLine, readCookie, noStoreWhenSignedIn };
