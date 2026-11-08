const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { CITIES, BCRYPT_ROUNDS } = require('../config');
const {
  clean, isEmail, isPkMobile, normalisePhone, isStrongPassword, isAdult, safeNext,
} = require('../validate');
const { createLimiter } = require('../middleware');

const router = express.Router();
const loginLimiter = createLimiter({ max: Number(process.env.LOGIN_MAX_ATTEMPTS) || 10, windowMs: 15 * 60 * 1000 });

// Pre-computed hash so unknown e-mails take as long as wrong passwords (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

/** Create a fresh session id on login/logout but keep the cart. */
function regenerate(req, cb) {
  const cart = req.session.cart;
  req.session.regenerate((err) => {
    if (err) return cb(err);
    if (cart) req.session.cart = cart;
    cb(null);
  });
}

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: 'Create your account', form: {}, errors: {}, cities: CITIES });
});

router.post('/register', (req, res, next) => {
  const form = {
    name: clean(req.body.name), email: clean(req.body.email).toLowerCase(),
    phone: clean(req.body.phone), city: clean(req.body.city), address: clean(req.body.address),
    dob: clean(req.body.dob),
  };
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const errors = {};

  if (form.name.length < 2 || form.name.length > 80) errors.name = 'Enter your full name (2-80 characters).';
  if (!isEmail(form.email)) errors.email = 'Enter a valid email address.';
  if (!isPkMobile(form.phone)) errors.phone = 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.';
  if (!CITIES.includes(form.city)) errors.city = 'Please choose your city.';
  if (form.address.length < 10 || form.address.length > 200) errors.address = 'Enter your full delivery address (10-200 characters).';
  if (!isAdult(form.dob)) errors.dob = 'You must be 18 or older to create an account.';
  if (!isStrongPassword(password)) errors.password = 'Password needs at least 8 characters, including a letter and a number.';
  if (password !== req.body.confirm) errors.confirm = 'Passwords do not match.';
  if (!errors.email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(form.email)) {
    errors.email = 'An account with this email already exists.';
  }
  if (Object.keys(errors).length) {
    return res.status(400).render('register', { title: 'Create your account', form, errors, cities: CITIES });
  }

  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, phone, city, address, dob) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(form.name, form.email, hash, normalisePhone(form.phone), form.city, form.address, form.dob);

  regenerate(req, (err) => {
    if (err) return next(err);
    req.session.userId = Number(info.lastInsertRowid);
    req.flash('success', `Welcome to Badal Vapes, ${form.name.split(' ')[0]}!`);
    res.redirect('/');
  });
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', next: safeNext(req.query.next), email: '', error: null });
});

router.post('/login', loginLimiter, (req, res, next) => {
  const email = clean(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const nextUrl = safeNext(req.body.next);

  const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
  const ok = bcrypt.compareSync(password, row ? row.password_hash : DUMMY_HASH) && !!row;
  if (!ok) {
    return res.status(401).render('login', {
      title: 'Sign in', next: nextUrl, email, error: 'Incorrect email or password.',
    });
  }
  regenerate(req, (err) => {
    if (err) return next(err);
    req.session.userId = row.id;
    res.redirect(nextUrl);
  });
});

router.post('/logout', (req, res, next) => {
  regenerate(req, (err) => {
    if (err) return next(err);
    delete req.session.cart;
    req.flash('success', 'You have been signed out.');
    res.redirect('/');
  });
});

/** Age gate confirmation (works with and without JavaScript). */
router.post('/age-verify', (req, res) => {
  // "Remember me" (ticked by default in the form) keeps the choice for 30 days; otherwise it lasts for the browser session.
  const remember = req.body.remember === 'on' || req.body.remember === true;
  res.cookie('age_ok', '1', {
    ...(remember ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}), httpOnly: true, sameSite: 'lax', secure: req.secure,
  });
  if (req.is('json') || req.get('x-requested-with') === 'fetch') return res.json({ ok: true });
  res.redirect(safeNext(req.body.next));
});

module.exports = router;
