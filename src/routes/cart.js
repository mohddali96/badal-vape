const express = require('express');
const { db, transaction } = require('../db');
const { CITIES, PAYMENT_METHODS, FREE_SHIPPING_OVER } = require('../config');
const { cartLines, shippingFor } = require('../queries');
const { clean, isPkMobile, normalisePhone, toInt } = require('../validate');
const { requireLogin } = require('../middleware');

const router = express.Router();
const MAX_QTY = 10;
const wantsJson = (req) => req.is('json') || req.get('x-requested-with') === 'fetch';

function cartCount(cart) {
  return Object.values(cart || {}).reduce((s, q) => s + q, 0);
}

router.get('/cart', (req, res) => {
  const { lines, subtotal } = cartLines(req.session.cart);
  res.render('cart', { title: 'Your cart', lines, subtotal, freeOver: FREE_SHIPPING_OVER });
});

router.post('/cart/add', (req, res) => {
  const id = toInt(req.body.productId);
  const qty = toInt(req.body.qty === undefined ? 1 : req.body.qty);
  const product = db.prepare('SELECT id, name, stock, active FROM products WHERE id = ?').get(id);
  const fail = (status, message) => {
    if (wantsJson(req)) return res.status(status).json({ ok: false, message });
    req.flash('error', message);
    return res.redirect(req.get('referer') || '/shop');
  };
  if (!product || !product.active) return fail(404, 'That product is no longer available.');
  if (!(qty >= 1 && qty <= MAX_QTY)) return fail(400, `Quantity must be between 1 and ${MAX_QTY}.`);

  const cart = req.session.cart || {};
  const newQty = Math.min((cart[id] || 0) + qty, MAX_QTY);
  if (newQty > product.stock) return fail(409, `Only ${product.stock} of "${product.name}" left in stock.`);
  cart[id] = newQty;
  req.session.cart = cart;

  const message = `Added "${product.name}" to your cart.`;
  if (wantsJson(req)) return res.json({ ok: true, message, count: cartCount(cart) });
  req.flash('success', message);
  res.redirect(req.get('referer') || '/cart');
});

router.post('/cart/update', (req, res) => {
  const id = toInt(req.body.productId);
  const qty = toInt(req.body.qty);
  const cart = req.session.cart || {};
  const product = db.prepare('SELECT stock FROM products WHERE id = ?').get(id);
  if (cart[id] && product && qty >= 0 && qty <= MAX_QTY) {
    if (qty === 0) delete cart[id];
    else if (qty > product.stock) req.flash('error', `Only ${product.stock} in stock.`);
    else cart[id] = qty;
  }
  req.session.cart = cart;
  res.redirect('/cart');
});

router.post('/cart/remove', (req, res) => {
  const id = toInt(req.body.productId);
  if (req.session.cart) delete req.session.cart[id];
  res.redirect('/cart');
});

router.get('/checkout', requireLogin, (req, res) => {
  const { lines, subtotal } = cartLines(req.session.cart);
  if (!lines.length) {
    req.flash('info', 'Your cart is empty.');
    return res.redirect('/shop');
  }
  const form = {
    name: req.user.name, phone: req.user.phone || '', city: req.user.city || '',
    address: req.user.address || '', payment: 'cod', notes: '',
  };
  res.render('checkout', {
    title: 'Checkout', lines, subtotal, shipping: shippingFor(form.city, subtotal),
    form, errors: {}, cities: CITIES,
  });
});

router.post('/checkout', requireLogin, (req, res, next) => {
  const { lines, subtotal } = cartLines(req.session.cart);
  if (!lines.length) return res.redirect('/cart');

  const form = {
    name: clean(req.body.name), phone: clean(req.body.phone), city: clean(req.body.city),
    address: clean(req.body.address), payment: clean(req.body.payment), notes: clean(req.body.notes).slice(0, 300),
  };
  const errors = {};
  if (form.name.length < 2 || form.name.length > 80) errors.name = 'Enter the receiver\'s name.';
  if (!isPkMobile(form.phone)) errors.phone = 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.';
  if (!CITIES.includes(form.city)) errors.city = 'Choose a delivery city.';
  if (form.address.length < 10 || form.address.length > 200) errors.address = 'Enter a full delivery address (10-200 characters).';
  if (!PAYMENT_METHODS[form.payment]) errors.payment = 'Choose a payment method.';
  if (req.body.age_confirm !== 'on') errors.age_confirm = 'You must confirm that you are 18 or older.';

  if (Object.keys(errors).length) {
    return res.status(400).render('checkout', {
      title: 'Checkout', lines, subtotal, shipping: shippingFor(form.city, subtotal),
      form, errors, cities: CITIES,
    });
  }

  try {
    const orderId = transaction(() => {
      // Re-check stock inside the transaction so concurrent orders cannot oversell.
      let sub = 0;
      const items = [];
      for (const l of lines) {
        const p = db.prepare('SELECT id, name, price_pkr, stock, active FROM products WHERE id = ?').get(l.id);
        if (!p || !p.active || p.stock < l.qty) {
          const err = new Error(`Sorry, "${l.name}" no longer has enough stock.`);
          err.userFacing = true;
          throw err;
        }
        sub += p.price_pkr * l.qty;
        items.push({ ...p, qty: l.qty });
      }
      const shipping = shippingFor(form.city, sub);
      const info = db.prepare(
        `INSERT INTO orders (user_id, subtotal_pkr, shipping_pkr, total_pkr, payment_method,
           ship_name, ship_phone, ship_city, ship_address, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(req.user.id, sub, shipping, sub + shipping, form.payment,
        form.name, normalisePhone(form.phone), form.city, form.address, form.notes || null);
      const orderId = Number(info.lastInsertRowid);
      for (const i of items) {
        db.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price_pkr, qty) VALUES (?, ?, ?, ?, ?)')
          .run(orderId, i.id, i.name, i.price_pkr, i.qty);
        db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(i.qty, i.id);
      }
      return orderId;
    });
    delete req.session.cart;
    req.flash('success', 'Order placed! Our team will call you on your mobile to confirm it.');
    res.redirect(`/account/orders/${orderId}`);
  } catch (err) {
    if (err.userFacing) {
      req.flash('error', err.message);
      return res.redirect('/cart');
    }
    next(err);
  }
});

module.exports = router;
