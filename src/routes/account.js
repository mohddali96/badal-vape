const express = require('express');
const bcrypt = require('bcryptjs');
const { db, transaction } = require('../db');
const { CITIES, BCRYPT_ROUNDS } = require('../config');
const { clean, isPkMobile, normalisePhone, isStrongPassword, toInt } = require('../validate');
const { requireLogin } = require('../middleware');

const router = express.Router();
router.use(requireLogin);

router.get('/orders', (req, res) => {
  const orders = db.prepare(
    `SELECT o.*, (SELECT SUM(qty) FROM order_items i WHERE i.order_id = o.id) AS item_count
     FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC, o.id DESC`).all(req.user.id);
  res.render('account/orders', { title: 'My orders', orders });
});

function loadOrder(req) {
  const id = toInt(req.params.id);
  // Ownership check: customers can only ever see their own orders.
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  return order;
}

router.get('/orders/:id', (req, res, next) => {
  const order = loadOrder(req);
  if (!order) return next();
  res.render('account/order', { title: `Order #${order.id}`, order });
});

router.post('/orders/:id/cancel', (req, res, next) => {
  const order = loadOrder(req);
  if (!order) return next();
  if (order.status !== 'Pending') {
    req.flash('error', 'Only pending orders can be cancelled. Please contact us for help.');
    return res.redirect(`/account/orders/${order.id}`);
  }
  transaction(() => {
    db.prepare("UPDATE orders SET status = 'Cancelled' WHERE id = ?").run(order.id);
    for (const i of order.items) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(i.qty, i.product_id);
  });
  req.flash('success', `Order #${order.id} has been cancelled.`);
  res.redirect(`/account/orders/${order.id}`);
});

router.get('/profile', (req, res) => {
  res.render('account/profile', {
    title: 'My profile', form: { ...req.user }, errors: {}, cities: CITIES,
  });
});

router.post('/profile', (req, res) => {
  const form = {
    name: clean(req.body.name), phone: clean(req.body.phone),
    city: clean(req.body.city), address: clean(req.body.address),
  };
  const errors = {};
  if (form.name.length < 2 || form.name.length > 80) errors.name = 'Enter your full name.';
  if (!isPkMobile(form.phone)) errors.phone = 'Enter a valid Pakistani mobile number.';
  if (!CITIES.includes(form.city)) errors.city = 'Choose your city.';
  if (form.address.length < 10 || form.address.length > 200) errors.address = 'Enter your full address (10-200 characters).';
  if (Object.keys(errors).length) {
    return res.status(400).render('account/profile', { title: 'My profile', form: { ...form, email: req.user.email }, errors, cities: CITIES });
  }
  db.prepare('UPDATE users SET name = ?, phone = ?, city = ?, address = ? WHERE id = ?')
    .run(form.name, normalisePhone(form.phone), form.city, form.address, req.user.id);
  req.flash('success', 'Profile updated.');
  res.redirect('/account/profile');
});

router.post('/password', (req, res) => {
  const current = typeof req.body.current === 'string' ? req.body.current : '';
  const next = typeof req.body.password === 'string' ? req.body.password : '';
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, row.password_hash)) {
    req.flash('error', 'Your current password is incorrect.');
  } else if (!isStrongPassword(next)) {
    req.flash('error', 'New password needs at least 8 characters, including a letter and a number.');
  } else if (next !== req.body.confirm) {
    req.flash('error', 'New passwords do not match.');
  } else {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, BCRYPT_ROUNDS), req.user.id);
    req.flash('success', 'Password changed.');
  }
  res.redirect('/account/profile');
});

module.exports = router;
