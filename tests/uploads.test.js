// Product image upload tests (TC-33 onwards).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, newClient, ADMIN, CUSTOMER } = require('./helpers');
const { db } = require('../src/db');
const { UPLOAD_DIR } = require('../src/uploads');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.close(); fs.rmSync(UPLOAD_DIR, { recursive: true, force: true }); });

// Smallest valid-looking files: only the signature bytes matter to the validator.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x40, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(64, 3)]);

const base = (extra = {}) => ({
  name: 'Photo Test Pod Kit', brand: 'TestBrand', description: 'A product used to test photo uploads.',
  category_id: '2', price_pkr: '5000', stock: '5', color: '#336699', active: 'on', ...extra,
});

async function adminOnProductForm() {
  const a = await newClient(srv.base);
  await a.login(ADMIN.email, ADMIN.password);
  await a.get('/admin/products/new');
  return a;
}
const filesOnDisk = () => fs.readdirSync(UPLOAD_DIR);

describe('Admin product photos', () => {
  test('TC-33 admin uploads a photo; it is stored, served and shown in the shop', async () => {
    const a = await adminOnProductForm();
    const r = await a.postMultipart('/admin/products', base(), { data: PNG, type: 'image/png', name: 'my photo.png' });
    assert.equal(r.status, 302);
    const p = db.prepare("SELECT * FROM products WHERE name = 'Photo Test Pod Kit'").get();
    assert.match(p.image, /^[0-9a-f-]{36}\.png$/, 'stored under a random name, not the original filename');
    assert.ok(filesOnDisk().includes(p.image));

    const img = await fetch(`${srv.base}/uploads/${p.image}`);
    assert.equal(img.status, 200);
    assert.equal(Buffer.from(await img.arrayBuffer()).equals(PNG), true);
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');

    const page = await a.get('/product/' + p.slug);
    assert.match(page.text, new RegExp(`<img class="art art--photo" src="/uploads/${p.image}"`));
    const shop = await a.get('/shop?q=Photo+Test');
    assert.match(shop.text, /art--photo/);
  });

  test('TC-34 JPG and WebP are accepted too', async () => {
    const a = await adminOnProductForm();
    for (const [name, data, type, ext] of [['JPG Product', JPG, 'image/jpeg', 'jpg'], ['WebP Product', WEBP, 'image/webp', 'webp']]) {
      const r = await a.postMultipart('/admin/products', base({ name }), { data, type, name: 'x.' + ext });
      assert.equal(r.status, 302, name);
      assert.match(db.prepare('SELECT image FROM products WHERE name = ?').get(name).image, new RegExp(`\\.${ext}$`));
    }
  });

  test('TC-35 non-images are rejected even when labelled as an image (signature check)', async () => {
    const a = await adminOnProductForm();
    const before = filesOnDisk().length;
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(80, ' '));
    const r = await a.postMultipart('/admin/products', base({ name: 'Fake Image Product' }), { data: html, type: 'image/png', name: 'evil.png' });
    assert.equal(r.status, 400);
    assert.match(r.text, /Only JPG, PNG or WebP/);
    assert.equal(db.prepare("SELECT 1 FROM products WHERE name = 'Fake Image Product'").get(), undefined);
    assert.equal(filesOnDisk().length, before, 'nothing written to disk');
  });

  test('TC-36 SVG uploads are rejected (script injection risk)', async () => {
    const a = await adminOnProductForm();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const r = await a.postMultipart('/admin/products', base({ name: 'SVG Product' }), { data: svg, type: 'image/svg+xml', name: 'x.svg' });
    assert.equal(r.status, 400);
    assert.equal(db.prepare("SELECT 1 FROM products WHERE name = 'SVG Product'").get(), undefined);
  });

  test('TC-37 files over 3 MB are rejected with a friendly message', async () => {
    const a = await adminOnProductForm();
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024 + 10, 9)]);
    const r = await a.postMultipart('/admin/products', base({ name: 'Huge Photo Product' }), { data: big, type: 'image/png', name: 'big.png' });
    assert.equal(r.status, 400);
    assert.match(r.text, /too large/);
    assert.equal(db.prepare("SELECT 1 FROM products WHERE name = 'Huge Photo Product'").get(), undefined);
  });

  test('TC-38 replacing a photo deletes the old file; "remove" clears it', async () => {
    const a = await adminOnProductForm();
    await a.postMultipart('/admin/products', base({ name: 'Replace Photo Product' }), { data: PNG, type: 'image/png', name: 'a.png' });
    const p = db.prepare("SELECT * FROM products WHERE name = 'Replace Photo Product'").get();
    const oldFile = p.image;

    await a.get(`/admin/products/${p.id}/edit`);
    await a.postMultipart(`/admin/products/${p.id}`, base({ name: 'Replace Photo Product' }), { data: JPG, type: 'image/jpeg', name: 'b.jpg' });
    const after1 = db.prepare('SELECT image FROM products WHERE id = ?').get(p.id).image;
    assert.notEqual(after1, oldFile);
    assert.match(after1, /\.jpg$/);
    assert.equal(filesOnDisk().includes(oldFile), false, 'old photo removed from disk');
    assert.equal(filesOnDisk().includes(after1), true);

    // Saving without choosing a file keeps the photo
    await a.postMultipart(`/admin/products/${p.id}`, base({ name: 'Replace Photo Product' }));
    assert.equal(db.prepare('SELECT image FROM products WHERE id = ?').get(p.id).image, after1);

    // Remove tick clears it
    await a.postMultipart(`/admin/products/${p.id}`, base({ name: 'Replace Photo Product', remove_image: 'on' }));
    assert.equal(db.prepare('SELECT image FROM products WHERE id = ?').get(p.id).image, null);
    assert.equal(filesOnDisk().includes(after1), false);
  });

  test('TC-39 deleting a product deletes its photo', async () => {
    const a = await adminOnProductForm();
    await a.postMultipart('/admin/products', base({ name: 'Delete Photo Product' }), { data: WEBP, type: 'image/webp', name: 'a.webp' });
    const p = db.prepare("SELECT * FROM products WHERE name = 'Delete Photo Product'").get();
    await a.get('/admin/products');
    await a.post(`/admin/products/${p.id}/delete`);
    assert.equal(db.prepare('SELECT 1 FROM products WHERE id = ?').get(p.id), undefined);
    assert.equal(filesOnDisk().includes(p.image), false);
  });

  test('TC-40 multipart upload without a valid CSRF token is blocked', async () => {
    const a = await adminOnProductForm();
    const r = await a.postMultipart('/admin/products', base({ name: 'No Csrf Product' }), { data: PNG, type: 'image/png', name: 'a.png' }, { csrf: 'forged' });
    assert.equal(r.status, 403);
    assert.equal(db.prepare("SELECT 1 FROM products WHERE name = 'No Csrf Product'").get(), undefined);
  });

  test('TC-41 customers and guests cannot upload; multipart is refused on other routes', async () => {
    const guest = await newClient(srv.base);
    const g = await guest.postMultipart('/admin/products', base({ name: 'Guest Product' }), { data: PNG, type: 'image/png', name: 'a.png' });
    assert.equal(g.status, 302); // sent to the login page
    assert.match(g.location, /^\/login/);

    const cust = await newClient(srv.base);
    await cust.login(CUSTOMER.email, CUSTOMER.password);
    const c = await cust.postMultipart('/admin/products', base({ name: 'Customer Product' }), { data: PNG, type: 'image/png', name: 'a.png' });
    assert.equal(c.status, 403);
    assert.equal(db.prepare("SELECT 1 FROM products WHERE name IN ('Guest Product', 'Customer Product')").get(), undefined);

    // A cross-site multipart form must not slip past CSRF protection on unrelated routes
    const logout = await cust.postMultipart('/logout', {});
    assert.equal(logout.status, 403);
  });

  test('TC-43 seeded products show real photos; credits page lists the photographers', async () => {
    const a = await newClient(srv.base);
    const withPhoto = db.prepare('SELECT COUNT(*) n FROM products WHERE image IS NOT NULL').get().n;
    const total = db.prepare("SELECT COUNT(*) n FROM products WHERE name NOT LIKE '%Photo%' AND name NOT LIKE '%Product%'").get().n;
    assert.ok(withPhoto >= 31, 'every seeded product has a photo');
    assert.ok(total >= 31);
    const p = db.prepare("SELECT image FROM products WHERE slug = 'voopoo-vinci-2-pod-kit'").get();
    assert.match(p.image, /^[0-9a-f-]{36}\.jpg$/);
    const img = await fetch(`${srv.base}/uploads/${p.image}`);
    assert.equal(img.status, 200);
    assert.match(img.headers.get('content-type'), /image\/jpeg/);
    const shop = await a.get('/shop');
    assert.match(shop.text, /art--photo/);
    const home = await a.get('/');
    assert.match(home.text, /\/img\/hero\.jpg/);
    const credits = await a.get('/credits');
    assert.equal(credits.status, 200);
    assert.match(credits.text, /Creative Commons/);
    assert.match(credits.text, /flickr\.com/);
    // each product owns its own copy, so deleting one photo cannot break another product
    const dupes = db.prepare('SELECT image, COUNT(*) n FROM products WHERE image IS NOT NULL GROUP BY image HAVING n > 1').all();
    assert.equal(dupes.length, 0);
  });

  test('TC-42 sale price: old price shows a discount badge; must be higher than price', async () => {
    const a = await adminOnProductForm();
    const bad = await a.postMultipart('/admin/products', base({ name: 'Bad Sale Product', old_price_pkr: '4000' }));
    assert.equal(bad.status, 400);
    assert.match(bad.text, /must be higher than the current price/);

    const ok = await a.postMultipart('/admin/products', base({ name: 'Good Sale Product', old_price_pkr: '6250' }));
    assert.equal(ok.status, 302);
    const p = db.prepare("SELECT slug FROM products WHERE name = 'Good Sale Product'").get();
    const page = await a.get('/product/' + p.slug);
    assert.match(page.text, /Rs 6,250/);
    assert.match(page.text, /Save Rs 1,250/);
    const sale = await a.get('/shop?sale=1');
    assert.match(sale.text, /Good Sale Product/);
    assert.match(sale.text, /-20%/);
    assert.doesNotMatch(sale.text, /Voopoo Drag 4/); // not discounted in the seed data
  });
});
