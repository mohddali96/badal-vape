const express = require('express');
const { db, transaction } = require('../db');
const { ORDER_STATUSES } = require('../config');
const { PRODUCT_SELECT } = require('../queries');
const { clean, toInt, slugify } = require('../validate');
const { requireAdmin, verifyCsrf } = require('../middleware');
const { acceptImage, saveImage, deleteImage, MAX_BYTES } = require('../uploads');

const router = express.Router();
router.use(requireAdmin);

router.get('/', (req, res) => {
  const stats = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM orders) AS orders,
       (SELECT COALESCE(SUM(total_pkr), 0) FROM orders WHERE status != 'Cancelled') AS revenue,
       (SELECT COUNT(*) FROM orders WHERE status = 'Pending') AS pending,
       (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
       (SELECT COUNT(*) FROM products WHERE active = 1) AS products,
       (SELECT COUNT(*) FROM messages WHERE is_read = 0) AS unread`).get();
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all();
  const byCity = db.prepare(
    `SELECT ship_city AS city, COUNT(*) AS n, SUM(total_pkr) AS revenue FROM orders
     WHERE status != 'Cancelled' GROUP BY ship_city ORDER BY revenue DESC LIMIT 5`).all();
  const lowStock = db.prepare('SELECT id, name, stock FROM products WHERE active = 1 AND stock <= 10 ORDER BY stock ASC LIMIT 6').all();
  const recent = db.prepare(
    `SELECT o.id, o.status, o.total_pkr, o.created_at, u.name AS customer FROM orders o
     JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC, o.id DESC LIMIT 6`).all();
  res.render('admin/dashboard', { title: 'Admin dashboard', stats, byStatus, byCity, lowStock, recent });
});

/* ---------- Products (full CRUD) ---------- */

function readProductForm(body) {
  const form = {
    name: clean(body.name), brand: clean(body.brand), description: clean(body.description),
    category_id: toInt(body.category_id), price_pkr: toInt(body.price_pkr), stock: toInt(body.stock),
    nicotine_mg: clean(body.nicotine_mg) === '' ? null : toInt(body.nicotine_mg),
    volume_ml: clean(body.volume_ml) === '' ? null : toInt(body.volume_ml),
    old_price_pkr: clean(body.old_price_pkr) === '' ? null : toInt(body.old_price_pkr),
    color: /^#[0-9a-fA-F]{6}$/.test(clean(body.color)) ? clean(body.color) : '#7c5cff',
    featured: body.featured === 'on' ? 1 : 0,
    active: body.active === 'on' ? 1 : 0,
  };
  const errors = {};
  if (form.name.length < 3 || form.name.length > 120) errors.name = 'Name must be 3-120 characters.';
  if (form.brand.length < 2 || form.brand.length > 60) errors.brand = 'Brand must be 2-60 characters.';
  if (form.description.length < 10 || form.description.length > 1000) errors.description = 'Description must be 10-1000 characters.';
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(form.category_id)) errors.category_id = 'Choose a category.';
  if (!(form.price_pkr >= 1 && form.price_pkr <= 1000000)) errors.price_pkr = 'Price must be between Rs 1 and Rs 1,000,000.';
  if (!(form.stock >= 0 && form.stock <= 100000)) errors.stock = 'Stock must be a whole number from 0 to 100000.';
  if (form.old_price_pkr !== null && !(form.old_price_pkr > form.price_pkr && form.old_price_pkr <= 1000000)) {
    errors.old_price_pkr = 'The old price must be higher than the current price (or leave it empty).';
  }
  if (form.nicotine_mg !== null && !(form.nicotine_mg >= 0 && form.nicotine_mg <= 60)) errors.nicotine_mg = 'Nicotine must be 0-60 mg/ml.';
  if (form.volume_ml !== null && !(form.volume_ml >= 1 && form.volume_ml <= 500)) errors.volume_ml = 'Volume must be 1-500 ml.';
  return { form, errors };
}

function uniqueSlug(name, ignoreId = 0) {
  const base = slugify(name) || 'product';
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM products WHERE slug = ? AND id != ?').get(slug, ignoreId); i++) slug = `${base}-${i}`;
  return slug;
}

const categoriesList = () => db.prepare('SELECT id, name FROM categories ORDER BY id').all();

router.get('/products', (req, res) => {
  const q = clean(req.query.q).slice(0, 60);
  const products = q
    ? db.prepare(`${PRODUCT_SELECT} WHERE p.name LIKE ? OR p.brand LIKE ? ORDER BY p.id DESC`).all(`%${q}%`, `%${q}%`)
    : db.prepare(`${PRODUCT_SELECT} ORDER BY p.id DESC`).all();
  res.render('admin/products', { title: 'Manage products', products, q });
});

router.get('/products/new', (req, res) => {
  res.render('admin/product-form', {
    title: 'Add product', product: null, errors: {}, categories: categoriesList(), maxMb: MAX_MB,
    form: { color: '#7c5cff', active: 1, featured: 0, stock: 10 },
  });
});

const MAX_MB = MAX_BYTES / 1024 / 1024;

router.post('/products', acceptImage, verifyCsrf, (req, res) => {
  const { form, errors } = readProductForm(req.body || {});
  if (req.uploadError) errors.image = req.uploadError;
  if (Object.keys(errors).length) {
    return res.status(400).render('admin/product-form', { title: 'Add product', product: null, errors, form, categories: categoriesList(), maxMb: MAX_MB });
  }
  const image = req.file ? saveImage(req.file) : null;
  const info = db.prepare(
    `INSERT INTO products (category_id, name, slug, brand, description, price_pkr, old_price_pkr, stock, nicotine_mg, volume_ml, color, image, featured, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(form.category_id, form.name, uniqueSlug(form.name), form.brand, form.description, form.price_pkr, form.old_price_pkr, form.stock,
    form.nicotine_mg, form.volume_ml, form.color, image, form.featured, form.active);
  req.flash('success', `Product "${form.name}" created.`);
  res.redirect('/admin/products#p' + info.lastInsertRowid);
});

router.get('/products/:id/edit', (req, res, next) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(toInt(req.params.id));
  if (!product) return next();
  res.render('admin/product-form', { title: `Edit ${product.name}`, product, errors: {}, form: product, categories: categoriesList(), maxMb: MAX_MB });
});

router.post('/products/:id', acceptImage, verifyCsrf, (req, res, next) => {
  const id = toInt(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return next();
  const { form, errors } = readProductForm(req.body || {});
  if (req.uploadError) errors.image = req.uploadError;
  if (Object.keys(errors).length) {
    return res.status(400).render('admin/product-form', { title: `Edit ${product.name}`, product, errors, form, categories: categoriesList(), maxMb: MAX_MB });
  }
  // New upload replaces the old photo; the "remove" tick clears it (falls back to the illustration).
  let image = product.image;
  if (req.file) image = saveImage(req.file);
  else if (req.body.remove_image === 'on') image = null;

  db.prepare(
    `UPDATE products SET category_id = ?, name = ?, slug = ?, brand = ?, description = ?, price_pkr = ?, old_price_pkr = ?, stock = ?,
       nicotine_mg = ?, volume_ml = ?, color = ?, image = ?, featured = ?, active = ? WHERE id = ?`
  ).run(form.category_id, form.name, uniqueSlug(form.name, id), form.brand, form.description, form.price_pkr, form.old_price_pkr, form.stock,
    form.nicotine_mg, form.volume_ml, form.color, image, form.featured, form.active, id);
  if (image !== product.image) deleteImage(product.image);
  req.flash('success', `Product "${form.name}" updated.`);
  res.redirect('/admin/products');
});

router.post('/products/:id/delete', (req, res, next) => {
  const id = toInt(req.params.id);
  const product = db.prepare('SELECT id, name, image FROM products WHERE id = ?').get(id);
  if (!product) return next();
  const used = db.prepare('SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1').get(id);
  if (used) {
    // Keep order history intact: hide the product instead of deleting it.
    db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
    req.flash('info', `"${product.name}" appears in past orders, so it was hidden from the shop instead of deleted.`);
  } else {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    deleteImage(product.image);
    req.flash('success', `"${product.name}" was deleted.`);
  }
  res.redirect('/admin/products');
});

/* ---------- Orders ---------- */

router.get('/orders', (req, res) => {
  const status = ORDER_STATUSES.includes(req.query.status) ? req.query.status : '';
  const orders = db.prepare(
    `SELECT o.*, u.name AS customer FROM orders o JOIN users u ON u.id = o.user_id
     ${status ? 'WHERE o.status = ?' : ''} ORDER BY o.created_at DESC, o.id DESC`).all(...(status ? [status] : []));
  res.render('admin/orders', { title: 'Manage orders', orders, status, statuses: ORDER_STATUSES });
});

router.get('/orders/:id', (req, res, next) => {
  const order = db.prepare(
    `SELECT o.*, u.name AS customer, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`).get(toInt(req.params.id));
  if (!order) return next();
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('admin/order', { title: `Order #${order.id}`, order, statuses: ORDER_STATUSES });
});

router.post('/orders/:id/status', (req, res, next) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(toInt(req.params.id));
  if (!order) return next();
  const status = req.body.status;
  if (!ORDER_STATUSES.includes(status)) {
    req.flash('error', 'Invalid status.');
    return res.redirect(`/admin/orders/${order.id}`);
  }
  if (order.status === 'Cancelled' || order.status === 'Delivered') {
    req.flash('error', `A ${order.status.toLowerCase()} order can no longer be changed.`);
    return res.redirect(`/admin/orders/${order.id}`);
  }
  transaction(() => {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
    if (status === 'Cancelled') {
      const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(order.id);
      for (const i of items) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(i.qty, i.product_id);
    }
  });
  req.flash('success', `Order #${order.id} marked as ${status}.`);
  res.redirect(`/admin/orders/${order.id}`);
});

/* ---------- Customers & messages ---------- */

router.get('/customers', (req, res) => {
  const customers = db.prepare(
    `SELECT u.id, u.name, u.email, u.phone, u.city, u.role, u.created_at,
       (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
       (SELECT COALESCE(SUM(total_pkr), 0) FROM orders o WHERE o.user_id = u.id AND o.status != 'Cancelled') AS spent
     FROM users u ORDER BY u.created_at DESC`).all();
  res.render('admin/customers', { title: 'Customers', customers });
});

router.get('/messages', (req, res) => {
  const messages = db.prepare('SELECT * FROM messages ORDER BY created_at DESC, id DESC').all();
  res.render('admin/messages', { title: 'Customer messages', messages });
});

router.post('/messages/:id/read', (req, res) => {
  db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(toInt(req.params.id));
  res.redirect('/admin/messages');
});

router.post('/messages/:id/delete', (req, res) => {
  db.prepare('DELETE FROM messages WHERE id = ?').run(toInt(req.params.id));
  req.flash('success', 'Message deleted.');
  res.redirect('/admin/messages');
});

module.exports = router;
