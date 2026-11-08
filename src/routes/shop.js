const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { db } = require('../db');
const { PAGE_SIZE } = require('../config');
const { PRODUCT_SELECT } = require('../queries');
const { clean, isEmail, toInt } = require('../validate');
const { requireLogin } = require('../middleware');

const router = express.Router();

const SORTS = {
  featured: 'p.featured DESC, p.created_at DESC',
  'price-asc': 'p.price_pkr ASC',
  'price-desc': 'p.price_pkr DESC',
  name: 'p.name COLLATE NOCASE ASC',
  rating: 'avg_rating DESC, review_count DESC',
};

router.get('/', (req, res) => {
  const featured = db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.featured = 1 ORDER BY p.created_at DESC LIMIT 8`).all();
  const categories = db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
     FROM categories c ORDER BY c.id`).all();
  const onSale = db.prepare(
    `${PRODUCT_SELECT} WHERE p.active = 1 AND p.old_price_pkr > p.price_pkr
     ORDER BY (p.old_price_pkr - p.price_pkr) * 1.0 / p.old_price_pkr DESC LIMIT 4`).all();
  const houseBlends = db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.brand = 'Badal House Blend' ORDER BY p.id LIMIT 4`).all();
  const topReviews = db.prepare(
    `SELECT r.rating, r.comment, u.name AS user_name, u.city, p.name AS product_name, p.slug
     FROM reviews r JOIN users u ON u.id = r.user_id JOIN products p ON p.id = r.product_id
     WHERE r.rating = 5 ORDER BY r.created_at DESC LIMIT 3`).all();
  res.render('home', { title: 'Vapes and e-liquid in Pakistan', featured, onSale, categories, houseBlends, topReviews });
});

router.get('/shop', (req, res) => {
  const q = clean(req.query.q).slice(0, 60);
  const category = clean(req.query.category);
  const sort = SORTS[req.query.sort] ? req.query.sort : 'featured';
  const page = Math.max(1, toInt(req.query.page) || 1);

  const where = ['p.active = 1'];
  const params = [];
  if (q) { where.push('(p.name LIKE ? OR p.brand LIKE ? OR p.description LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category) { where.push('c.slug = ?'); params.push(category); }
  const sale = req.query.sale === '1';
  if (sale) where.push('p.old_price_pkr > p.price_pkr');

  const base = `${PRODUCT_SELECT} WHERE ${where.join(' AND ')}`;
  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM products p JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}`).get(...params).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const products = db.prepare(`${base} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, (current - 1) * PAGE_SIZE);
  const categories = db.prepare('SELECT name, slug FROM categories ORDER BY id').all();
  const activeCategory = categories.find((c) => c.slug === category) || null;

  res.render('shop', {
    title: sale ? 'Sale' : activeCategory ? activeCategory.name : 'Shop all vapes',
    products, categories, activeCategory, q, category, sort, sale, page: current, pages, total,
  });
});

router.get('/product/:slug', (req, res, next) => {
  const product = db.prepare(`${PRODUCT_SELECT} WHERE p.slug = ? AND p.active = 1`).get(req.params.slug);
  if (!product) return next();
  const reviews = db.prepare(
    `SELECT r.*, u.name AS user_name, u.city FROM reviews r JOIN users u ON u.id = r.user_id
     WHERE r.product_id = ? ORDER BY r.created_at DESC`).all(product.id);
  const related = db.prepare(
    `${PRODUCT_SELECT} WHERE p.active = 1 AND p.category_id = ? AND p.id != ? ORDER BY p.featured DESC LIMIT 4`)
    .all(product.category_id, product.id);
  const myReview = req.user ? reviews.find((r) => r.user_id === req.user.id) || null : null;
  res.render('product', { title: product.name, product, reviews, related, myReview });
});

router.post('/product/:slug/review', requireLogin, (req, res, next) => {
  const product = db.prepare('SELECT id, slug FROM products WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!product) return next();
  const rating = toInt(req.body.rating);
  const comment = clean(req.body.comment);
  if (!(rating >= 1 && rating <= 5) || comment.length < 5 || comment.length > 600) {
    req.flash('error', 'Please choose a rating (1-5) and write a comment of 5-600 characters.');
    return res.redirect(`/product/${product.slug}#reviews`);
  }
  // One review per customer per product: create or update (CRUD: C + U).
  db.prepare(
    `INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)
     ON CONFLICT (product_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = CURRENT_TIMESTAMP`
  ).run(product.id, req.user.id, rating, comment);
  req.flash('success', 'Thank you! Your review has been saved.');
  res.redirect(`/product/${product.slug}#reviews`);
});

router.post('/product/:slug/review/delete', requireLogin, (req, res, next) => {
  const product = db.prepare('SELECT id, slug FROM products WHERE slug = ?').get(req.params.slug);
  if (!product) return next();
  db.prepare('DELETE FROM reviews WHERE product_id = ? AND user_id = ?').run(product.id, req.user.id);
  req.flash('success', 'Your review was deleted.');
  res.redirect(`/product/${product.slug}#reviews`);
});

router.get('/credits', (req, res) => {
  let credits = [];
  try { credits = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'seed-images', 'credits.json'), 'utf8')); } catch { /* no credits file */ }
  res.render('credits', { title: 'Image credits', credits });
});

router.get('/about', (req, res) => res.render('about', { title: 'Stores and delivery' }));

router.get('/contact', (req, res) => res.render('contact', { title: 'Contact us', form: {}, errors: {} }));

router.post('/contact', (req, res) => {
  const form = {
    name: clean(req.body.name), email: clean(req.body.email),
    subject: clean(req.body.subject), body: clean(req.body.body),
  };
  const errors = {};
  if (form.name.length < 2 || form.name.length > 80) errors.name = 'Please enter your name.';
  if (!isEmail(form.email)) errors.email = 'Please enter a valid email address.';
  if (form.subject.length < 3 || form.subject.length > 120) errors.subject = 'Subject must be 3-120 characters.';
  if (form.body.length < 10 || form.body.length > 1500) errors.body = 'Message must be 10-1500 characters.';
  if (Object.keys(errors).length) {
    return res.status(400).render('contact', { title: 'Contact us', form, errors });
  }
  db.prepare('INSERT INTO messages (name, email, subject, body) VALUES (?, ?, ?, ?)')
    .run(form.name, form.email, form.subject, form.body);
  req.flash('success', 'Shukriya! Your message has been sent. We reply within one working day.');
  res.redirect('/contact');
});

router.get('/age-restricted', (req, res) => {
  res.locals.showAgeGate = false;
  res.render('age-restricted', { title: 'Adults only' });
});

module.exports = router;
