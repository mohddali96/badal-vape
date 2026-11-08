const crypto = require('node:crypto');
const { db } = require('./db');
const { safeNext } = require('./validate');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Flash messages stored in the session and exposed to the next rendered page. */
function flash(req, res, next) {
  req.flash = (type, message) => {
    (req.session.flash = req.session.flash || []).push({ type, message });
  };
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  next();
}

function tokenMatches(req) {
  const sent = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
  const expected = req.session.csrf;
  return sent.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
}

function blocked(res) {
  return res.status(403).render('error', {
    title: 'Request blocked', code: 403,
    message: 'Your form session expired or the request could not be verified. Please go back, refresh the page and try again.',
  });
}

// Multipart bodies are only parsed by multer inside these admin routes, so the token is
// checked there (verifyCsrf) instead of here. Multipart posts anywhere else are refused.
const MULTIPART_DEFERRED = /^\/admin\/products(?:\/\d+)?$/;

/** Synchroniser-token CSRF protection for every state-changing request. */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  if (req.is('multipart/form-data')) {
    if (MULTIPART_DEFERRED.test(req.path)) return next();
    return blocked(res);
  }
  if (!tokenMatches(req)) return blocked(res);
  next();
}

/** Second half of the CSRF check for multipart routes, run after multer has read the form. */
function verifyCsrf(req, res, next) {
  if (!tokenMatches(req)) return blocked(res);
  next();
}

/** Load the signed-in user (if any) for every request. */
function attachUser(req, res, next) {
  res.locals.user = null;
  req.user = null;
  const id = req.session.userId;
  if (id) {
    const u = db.prepare('SELECT id, name, email, phone, city, address, role FROM users WHERE id = ?').get(id);
    if (u) { req.user = u; res.locals.user = u; } else delete req.session.userId;
  }
  res.locals.cartCount = Object.values(req.session.cart || {}).reduce((s, q) => s + q, 0);
  next();
}

/** 18+ age gate: shown until the visitor confirms (cookie set by /age-verify). */
function ageGate(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  res.locals.showAgeGate = cookies.age_ok !== '1';
  next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  req.flash('info', 'Please sign in to continue.');
  const target = safeNext(req.originalUrl);
  res.redirect('/login?next=' + encodeURIComponent(target));
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    req.flash('info', 'Please sign in to continue.');
    return res.redirect('/login?next=' + encodeURIComponent(safeNext(req.originalUrl)));
  }
  if (req.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Access denied', code: 403, message: 'You do not have permission to view this page.',
    });
  }
  next();
}

/** Very small in-memory throttle for login attempts (per IP). */
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).render('error', {
        title: 'Too many attempts', code: 429,
        message: 'Too many attempts. Please wait a few minutes and try again.',
      });
    }
    next();
  };
}

module.exports = { flash, csrf, verifyCsrf, attachUser, ageGate, requireLogin, requireAdmin, createLimiter, parseCookies };
