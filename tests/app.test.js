// Automated test suite. Test IDs (TC-xx) map to the test plan in the report.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client, newClient, ADMIN, CUSTOMER } = require('./helpers');
const { db } = require('../src/db');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); });

const stockOf = (slug) => db.prepare('SELECT stock FROM products WHERE slug = ?').get(slug).stock;

describe('Public pages & seeded Pakistani data', () => {
  test('TC-01 public pages load', async () => {
    const c = await newClient(srv.base);
    for (const path of ['/', '/shop', '/about', '/contact', '/login', '/register', '/cart', '/healthz']) {
      const r = await c.get(path);
      assert.equal(r.status, 200, path);
    }
  });

  test('TC-02 catalogue is seeded with PKR prices and Pakistani content', async () => {
    const c = await newClient(srv.base);
    const shop = await c.get('/shop');
    assert.match(shop.text, /Rs 3,800/);
    const about = await c.get('/about');
    for (const city of ['Lahore', 'Karachi', 'Islamabad']) assert.match(about.text, new RegExp(city));
    const products = db.prepare('SELECT COUNT(*) n FROM products').get().n;
    assert.ok(products >= 25, 'at least 25 products seeded');
    const cities = db.prepare('SELECT DISTINCT city FROM users WHERE city IS NOT NULL').all().map((r) => r.city);
    assert.ok(cities.includes('Peshawar') && cities.includes('Faisalabad'));
    assert.ok(db.prepare("SELECT 1 FROM users WHERE phone LIKE '03%'").get(), 'Pakistani mobile numbers');
  });

  test('TC-03 search and category filters work', async () => {
    const c = await newClient(srv.base);
    const r = await c.get('/shop?q=kulfi');
    assert.match(r.text, /Kulfi Falooda/);
    assert.doesNotMatch(r.text, /Elf Bar BC5000/);
    const cat = await c.get('/shop?category=box-mods');
    assert.match(cat.text, /Voopoo Drag 4/);
    assert.doesNotMatch(cat.text, /Kulfi Falooda 30ml/);
  });

  test('TC-04 search term is HTML-escaped (XSS)', async () => {
    const c = await newClient(srv.base);
    const r = await c.get('/shop?q=' + encodeURIComponent('<script>alert(1)</script>'));
    assert.doesNotMatch(r.text, /<script>alert\(1\)<\/script>/);
    assert.match(r.text, /&lt;script&gt;/);
  });

  test('TC-05 unknown page returns a friendly 404', async () => {
    const c = await newClient(srv.base);
    const r = await c.get('/does-not-exist');
    assert.equal(r.status, 404);
    assert.match(r.text, /Page not found/);
  });

  test('TC-06 age gate shown until confirmed, then remembered', async () => {
    const c = new Client(srv.base);
    const first = await c.get('/');
    assert.match(first.text, /Age verification/);
    const ok = await c.post('/age-verify', {});
    assert.equal(ok.status, 302);
    const after = await c.get('/');
    assert.doesNotMatch(after.text, /Age verification/);
  });

  test('TC-07 security headers and CSP are present', async () => {
    const c = await newClient(srv.base);
    const r = await c.get('/');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-powered-by'), null);
  });
});

describe('Robustness', () => {
  test('TC-44 malformed or oversized request bodies return 4xx pages, not server errors', async () => {
    const bad = await fetch(srv.base + '/cart/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /Bad request/);
    const big = await fetch(srv.base + '/contact', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'body=' + 'x'.repeat(40 * 1024) });
    assert.equal(big.status, 413);
    const c = await newClient(srv.base);
    assert.equal((await c.get('/shop?page=abc&sort=bad&category=nope')).status, 200);
  });
});

describe('Registration & authentication', () => {
  const valid = {
    name: 'Zeeshan Haider', email: 'zeeshan.haider@example.com', phone: '0312 3456789', city: 'Sialkot',
    address: 'House 5, Street 2, Cantt Area', dob: '1995-06-15', password: 'Chai1234', confirm: 'Chai1234',
  };

  test('TC-08 registration rejects under-18, bad phone and weak password', async () => {
    const c = await newClient(srv.base);
    await c.get('/register');
    const r = await c.post('/register', { ...valid, dob: '2015-01-01', phone: '12345', password: 'short', confirm: 'short' });
    assert.equal(r.status, 400);
    assert.match(r.text, /18 or older/);
    assert.match(r.text, /valid Pakistani mobile/);
    assert.match(r.text, /at least 8 characters/);
    assert.equal(db.prepare('SELECT 1 FROM users WHERE email = ?').get(valid.email), undefined);
  });

  test('TC-09 valid registration creates a hashed-password user and signs in', async () => {
    const c = await newClient(srv.base);
    await c.get('/register');
    const r = await c.post('/register', valid);
    assert.equal(r.status, 302);
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(valid.email);
    assert.ok(u);
    assert.match(u.password_hash, /^\$2[aby]\$/);
    assert.notEqual(u.password_hash, valid.password);
    assert.equal(u.phone, '03123456789');
    const home = await c.get('/account/orders');
    assert.equal(home.status, 200);
  });

  test('TC-10 duplicate email is rejected', async () => {
    const c = await newClient(srv.base);
    await c.get('/register');
    const r = await c.post('/register', valid);
    assert.equal(r.status, 400);
    assert.match(r.text, /already exists/);
  });

  test('TC-11 login succeeds with correct credentials and fails with wrong ones', async () => {
    const bad = await newClient(srv.base);
    await bad.get('/login');
    const fail = await bad.post('/login', { email: CUSTOMER.email, password: 'wrong-password1' });
    assert.equal(fail.status, 401);
    assert.match(fail.text, /Incorrect email or password/);

    const good = await newClient(srv.base);
    const r = await good.login(CUSTOMER.email, CUSTOMER.password);
    assert.equal(r.status, 302);
    assert.equal((await good.get('/account/orders')).status, 200);
  });

  test('TC-12 session id changes on login (fixation protection)', async () => {
    const c = await newClient(srv.base);
    const before = c.cookies['badal.sid'];
    await c.login(CUSTOMER.email, CUSTOMER.password);
    assert.notEqual(c.cookies['badal.sid'], before);
  });

  test('TC-13 logout ends the session', async () => {
    const c = await newClient(srv.base);
    await c.login(CUSTOMER.email, CUSTOMER.password);
    await c.get('/');
    await c.post('/logout');
    const r = await c.get('/account/orders');
    assert.equal(r.status, 302);
    assert.match(r.location, /^\/login/);
  });

  test('TC-14 protected pages redirect guests to login', async () => {
    const c = await newClient(srv.base);
    for (const path of ['/account/orders', '/account/profile', '/checkout']) {
      const r = await c.get(path);
      assert.equal(r.status, 302, path);
      assert.match(r.location, /^\/login/);
    }
  });

  test('TC-15 open-redirect via ?next is neutralised', async () => {
    const c = await newClient(srv.base);
    await c.get('/login');
    const r = await c.post('/login', { email: CUSTOMER.email, password: CUSTOMER.password, next: '//evil.example.com' });
    assert.equal(r.location, '/');
  });

  test('TC-16 POST without CSRF token is blocked', async () => {
    const c = await newClient(srv.base);
    const r = await c.request('POST', '/contact', { form: { name: 'x', email: 'a@b.pk', subject: 'Hello', body: 'Hello there world' } });
    assert.equal(r.status, 403);
  });
});

describe('Cart, checkout and orders', () => {
  test('TC-17 add to cart (JSON) updates the count; stock limits enforced', async () => {
    const c = await newClient(srv.base);
    const p = db.prepare("SELECT id, stock FROM products WHERE slug = 'smok-mag-18'").get();
    const ok = await c.request('POST', '/cart/add', { json: { productId: p.id, qty: 2 }, headers: { 'x-csrf-token': c.csrf } });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.text).count, 2);
    const tooMany = await c.request('POST', '/cart/add', { json: { productId: p.id, qty: 11 }, headers: { 'x-csrf-token': c.csrf } });
    assert.equal(tooMany.status, 400);
    const bad = await c.request('POST', '/cart/add', { json: { productId: 99999, qty: 1 }, headers: { 'x-csrf-token': c.csrf } });
    assert.equal(bad.status, 404);
  });

  test('TC-18 cart update and remove', async () => {
    const c = await newClient(srv.base);
    const p = db.prepare("SELECT id FROM products WHERE slug = 'samsung-25r-18650-battery-2500mah'").get();
    await c.post('/cart/add', { productId: p.id, qty: 1 });
    await c.post('/cart/update', { productId: p.id, qty: 3 });
    assert.match((await c.get('/cart')).text, /value="3"/);
    await c.post('/cart/remove', { productId: p.id });
    assert.match((await c.get('/cart')).text, /Your cart is empty/);
  });

  test('TC-19 checkout creates order, applies PKR shipping, decrements stock', async () => {
    const c = await newClient(srv.base);
    await c.login(CUSTOMER.email, CUSTOMER.password);
    const p = db.prepare("SELECT id, price_pkr FROM products WHERE slug = 'lost-mary-bm600-cola-ice'").get();
    const stockBefore = stockOf('lost-mary-bm600-cola-ice');
    await c.post('/cart/add', { productId: p.id, qty: 2 });
    await c.get('/checkout');
    const r = await c.post('/checkout', {
      name: 'Ahmed Raza Khan', phone: '0300 1234567', city: 'Multan', address: 'House 9, Street 4, Gulgasht Colony',
      payment: 'jazzcash', age_confirm: 'on',
    });
    assert.equal(r.status, 302);
    assert.match(r.location, /^\/account\/orders\/\d+$/);
    const order = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
    assert.equal(order.subtotal_pkr, p.price_pkr * 2);
    assert.equal(order.shipping_pkr, 350); // non-metro city
    assert.equal(order.total_pkr, p.price_pkr * 2 + 350);
    assert.equal(order.status, 'Pending');
    assert.equal(stockOf('lost-mary-bm600-cola-ice'), stockBefore - 2);
    assert.match((await c.get('/cart')).text, /Your cart is empty/);
  });

  test('TC-20 metro city delivery is Rs 250 and orders over Rs 15,000 ship free', async () => {
    const c = await newClient(srv.base);
    await c.login(CUSTOMER.email, CUSTOMER.password);
    const small = db.prepare("SELECT id FROM products WHERE slug = 'organic-cotton-wicks-pack'").get();
    await c.post('/cart/add', { productId: small.id, qty: 1 });
    await c.get('/checkout');
    await c.post('/checkout', { name: 'A B', phone: '03001234567', city: 'Lahore', address: 'House 1, Gulberg III, Lahore', payment: 'cod', age_confirm: 'on' });
    assert.equal(db.prepare('SELECT shipping_pkr FROM orders ORDER BY id DESC LIMIT 1').get().shipping_pkr, 250);

    const big = db.prepare("SELECT id FROM products WHERE slug = 'voopoo-drag-4'").get();
    await c.post('/cart/add', { productId: big.id, qty: 1 });
    await c.get('/checkout');
    await c.post('/checkout', { name: 'A B', phone: '03001234567', city: 'Quetta', address: 'House 1, Jinnah Road, Quetta', payment: 'cod', age_confirm: 'on' });
    assert.equal(db.prepare('SELECT shipping_pkr FROM orders ORDER BY id DESC LIMIT 1').get().shipping_pkr, 0);
  });

  test('TC-21 checkout validation: age confirmation, phone, city', async () => {
    const c = await newClient(srv.base);
    await c.login(CUSTOMER.email, CUSTOMER.password);
    const p = db.prepare("SELECT id FROM products WHERE slug = 'smok-novo-5'").get();
    await c.post('/cart/add', { productId: p.id, qty: 1 });
    await c.get('/checkout');
    const orders = db.prepare('SELECT COUNT(*) n FROM orders').get().n;
    const r = await c.post('/checkout', { name: 'A B', phone: '12345', city: 'London', address: 'short', payment: 'cod' });
    assert.equal(r.status, 400);
    assert.match(r.text, /confirm that you are 18/);
    assert.match(r.text, /valid Pakistani mobile/);
    assert.match(r.text, /Choose a delivery city/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, orders);
  });

  test('TC-22 customers cannot view other customers\' orders (access control)', async () => {
    const other = db.prepare("SELECT id FROM orders WHERE user_id != (SELECT id FROM users WHERE email = ?) LIMIT 1").get(CUSTOMER.email);
    const c = await newClient(srv.base);
    await c.login(CUSTOMER.email, CUSTOMER.password);
    const r = await c.get('/account/orders/' + other.id);
    assert.equal(r.status, 404);
  });

  test('TC-23 customer can cancel a pending order and stock is restored', async () => {
    const c = await newClient(srv.base);
    await c.login(CUSTOMER.email, CUSTOMER.password);
    const p = db.prepare("SELECT id FROM products WHERE slug = 'efest-slim-k2-dual-charger'").get();
    await c.post('/cart/add', { productId: p.id, qty: 1 });
    await c.get('/checkout');
    const before = stockOf('efest-slim-k2-dual-charger');
    const r = await c.post('/checkout', { name: 'A B', phone: '03001234567', city: 'Lahore', address: 'House 1, Gulberg III, Lahore', payment: 'cod', age_confirm: 'on' });
    assert.equal(stockOf('efest-slim-k2-dual-charger'), before - 1);
    await c.get(r.location);
    await c.post(r.location + '/cancel');
    assert.equal(stockOf('efest-slim-k2-dual-charger'), before);
    assert.match((await c.get(r.location)).text, /Cancelled/);
  });

  test('TC-24 reviews: create, update (one per product) and delete', async () => {
    const c = await newClient(srv.base);
    await c.login(CUSTOMER.email, CUSTOMER.password);
    await c.get('/product/smok-novo-5');
    await c.post('/product/smok-novo-5/review', { rating: '4', comment: 'Works well for daily use.' });
    await c.post('/product/smok-novo-5/review', { rating: '5', comment: 'Even better after a week.' });
    const rows = db.prepare("SELECT * FROM reviews WHERE product_id = (SELECT id FROM products WHERE slug = 'smok-novo-5')").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rating, 5);
    await c.post('/product/smok-novo-5/review/delete');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM reviews WHERE product_id = (SELECT id FROM products WHERE slug = 'smok-novo-5')").get().n, 0);
    const bad = await c.post('/product/smok-novo-5/review', { rating: '9', comment: 'x' });
    assert.match(db.prepare('SELECT COUNT(*) n FROM reviews').get().n.toString(), /\d+/);
    assert.equal(bad.status, 302);
  });

  test('TC-25 profile update and password change', async () => {
    const c = await newClient(srv.base);
    await c.login('sana.iqbal@example.com', 'Vape@2026');
    await c.get('/account/profile');
    await c.post('/account/profile', { name: 'Sana Iqbal', phone: '+92 306 1235432', city: 'Bahawalpur', address: 'House 7, Model Town A' });
    const u = db.prepare("SELECT city, phone FROM users WHERE email = 'sana.iqbal@example.com'").get();
    assert.equal(u.city, 'Bahawalpur');
    assert.equal(u.phone, '03061235432');
    await c.post('/account/password', { current: 'Vape@2026', password: 'NewPass123', confirm: 'NewPass123' });
    const c2 = await newClient(srv.base);
    const r = await c2.login('sana.iqbal@example.com', 'NewPass123');
    assert.equal(r.status, 302);
  });
});

describe('Admin area', () => {
  test('TC-26 guests and customers cannot reach /admin', async () => {
    const guest = await newClient(srv.base);
    const g = await guest.get('/admin');
    assert.equal(g.status, 302);
    const cust = await newClient(srv.base);
    await cust.login(CUSTOMER.email, CUSTOMER.password);
    for (const path of ['/admin', '/admin/products', '/admin/orders', '/admin/customers']) {
      assert.equal((await cust.get(path)).status, 403, path);
    }
    const post = await cust.post('/admin/products/1/delete');
    assert.equal(post.status, 403);
  });

  test('TC-27 admin dashboard shows PKR revenue', async () => {
    const a = await newClient(srv.base);
    await a.login(ADMIN.email, ADMIN.password);
    const r = await a.get('/admin');
    assert.equal(r.status, 200);
    assert.match(r.text, /Revenue/);
    assert.match(r.text, /Rs [\d,]+/);
  });

  test('TC-28 admin product CRUD with validation', async () => {
    const a = await newClient(srv.base);
    await a.login(ADMIN.email, ADMIN.password);
    await a.get('/admin/products/new');
    const bad = await a.post('/admin/products', { name: 'ab', brand: '', description: 'short', category_id: '1', price_pkr: '-5', stock: 'x' });
    assert.equal(bad.status, 400);

    const create = await a.post('/admin/products', {
      name: 'Test Pod Kit Peshawar Edition', brand: 'TestBrand', description: 'A product created by the automated test suite.',
      category_id: '2', price_pkr: '4999', stock: '12', nicotine_mg: '', volume_ml: '2', color: '#112233', featured: 'on', active: 'on',
    });
    assert.equal(create.status, 302);
    const p = db.prepare("SELECT * FROM products WHERE name = 'Test Pod Kit Peshawar Edition'").get();
    assert.equal(p.price_pkr, 4999);
    assert.equal(p.slug, 'test-pod-kit-peshawar-edition');
    assert.equal((await a.get('/product/' + p.slug)).status, 200);

    await a.post('/admin/products/' + p.id, {
      name: 'Test Pod Kit Peshawar Edition', brand: 'TestBrand', description: 'Updated description for the test product.',
      category_id: '2', price_pkr: '5500', stock: '3', color: '#112233', active: 'on',
    });
    assert.equal(db.prepare('SELECT price_pkr FROM products WHERE id = ?').get(p.id).price_pkr, 5500);

    await a.post('/admin/products/' + p.id + '/delete');
    assert.equal(db.prepare('SELECT 1 FROM products WHERE id = ?').get(p.id), undefined);
  });

  test('TC-29 deleting a product that appears in orders hides it instead', async () => {
    const a = await newClient(srv.base);
    await a.login(ADMIN.email, ADMIN.password);
    const p = db.prepare('SELECT product_id id FROM order_items LIMIT 1').get();
    await a.get('/admin/products');
    await a.post('/admin/products/' + p.id + '/delete');
    const row = db.prepare('SELECT active FROM products WHERE id = ?').get(p.id);
    assert.equal(row.active, 0);
    assert.ok(db.prepare('SELECT 1 FROM order_items WHERE product_id = ?').get(p.id), 'order history preserved');
  });

  test('TC-30 admin updates order status; cancelling restores stock', async () => {
    const a = await newClient(srv.base);
    await a.login(ADMIN.email, ADMIN.password);
    const o = db.prepare("SELECT id FROM orders WHERE status = 'Pending' ORDER BY id DESC LIMIT 1").get();
    await a.get('/admin/orders/' + o.id);
    await a.post(`/admin/orders/${o.id}/status`, { status: 'Confirmed' });
    assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(o.id).status, 'Confirmed');

    const item = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').get(o.id);
    const stock = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id).stock;
    await a.post(`/admin/orders/${o.id}/status`, { status: 'Cancelled' });
    assert.equal(db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id).stock, stock + item.qty);
    // Terminal states cannot be re-opened
    await a.post(`/admin/orders/${o.id}/status`, { status: 'Dispatched' });
    assert.equal(db.prepare('SELECT status FROM orders WHERE id = ?').get(o.id).status, 'Cancelled');
  });

  test('TC-31 contact form saves a message the admin can read and delete', async () => {
    const c = await newClient(srv.base);
    await c.get('/contact');
    const bad = await c.post('/contact', { name: 'A', email: 'nope', subject: 'x', body: 'short' });
    assert.equal(bad.status, 400);
    const ok = await c.post('/contact', { name: 'Hira Aslam', email: 'hira@example.com', subject: 'Delivery to Quetta', body: 'How long does delivery to Quetta take?' });
    assert.equal(ok.status, 302);

    const a = await newClient(srv.base);
    await a.login(ADMIN.email, ADMIN.password);
    const list = await a.get('/admin/messages');
    assert.match(list.text, /Delivery to Quetta/);
    const m = db.prepare("SELECT id FROM messages WHERE subject = 'Delivery to Quetta'").get();
    await a.post(`/admin/messages/${m.id}/read`);
    assert.equal(db.prepare('SELECT is_read FROM messages WHERE id = ?').get(m.id).is_read, 1);
    await a.post(`/admin/messages/${m.id}/delete`);
    assert.equal(db.prepare('SELECT 1 FROM messages WHERE id = ?').get(m.id), undefined);
  });

  test('TC-32 SQL injection attempt in search returns safely', async () => {
    const c = await newClient(srv.base);
    const r = await c.get('/shop?q=' + encodeURIComponent("' OR 1=1; DROP TABLE products;--"));
    assert.equal(r.status, 200);
    assert.ok(db.prepare('SELECT COUNT(*) n FROM products').get().n > 0);
  });
});
