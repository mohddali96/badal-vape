// Demo data for the Pakistani market. All people, phone numbers and addresses
// are fictional. Prices are in PKR.
const bcrypt = require('bcryptjs');
const { BCRYPT_ROUNDS } = require('./config');
const { slugify } = require('./validate');

// Demo credentials (change ADMIN_PASSWORD in the environment for a live site).
// Known demo passwords are used only in development and tests. In production, anything not supplied
// through the environment gets a random password, so a forgotten setting can never leave a public default.
const isProd = process.env.NODE_ENV === 'production';
const randomPassword = () => require('node:crypto').randomBytes(9).toString('base64url') + 'a1';
const DEMO_CUSTOMER_PASSWORD = process.env.DEMO_CUSTOMER_PASSWORD || (isProd ? randomPassword() : 'Vape@2026');
const ADMIN_EMAIL = 'admin@badalvapes.pk';
const generatedAdminPassword = !process.env.ADMIN_PASSWORD && isProd ? randomPassword() : null;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || generatedAdminPassword || 'Admin@2026';

const categories = [
  ['Disposables', 'disposables', 'Ready-to-use disposable vapes in popular flavours. No refilling, no charging fuss.'],
  ['Pod Systems', 'pod-systems', 'Compact refillable pod kits for mouth-to-lung vaping and nicotine salts.'],
  ['Box Mods', 'box-mods', 'Powerful adjustable-wattage devices for experienced vapers.'],
  ['E-Liquids', 'e-liquids', 'Freebase and nicotine-salt juices, including our own Pakistani-inspired house blends.'],
  ['Coils & Pods', 'coils-pods', 'Replacement coils and cartridges for the most popular devices.'],
  ['Accessories', 'accessories', 'Batteries, chargers, cotton and everyday essentials.'],
];

// [name, brand, category slug, price PKR, stock, nicotine mg/ml, volume ml, colour, featured, description]
const products = [
  ['Elf Bar BC5000 - Blue Razz Ice', 'Elf Bar', 'disposables', 3800, 40, 50, null, '#3b82f6', 1,
    'Up to 5000 puffs with a rechargeable battery and mesh coil. Sweet blue raspberry finished with a cool menthol exhale.'],
  ['Elf Bar BC5000 - Watermelon Ice', 'Elf Bar', 'disposables', 3800, 35, 50, null, '#ef4444', 0,
    'Juicy watermelon chilled with ice. Rechargeable via USB-C, around 5000 puffs.'],
  ['Lost Mary BM600 - Mango Peach', 'Lost Mary', 'disposables', 2400, 60, 20, null, '#f59e0b', 1,
    'A light, fruity 600-puff disposable that is perfect for first-time switchers. 2% nicotine salt.'],
  ['Lost Mary BM600 - Cola Ice', 'Lost Mary', 'disposables', 2400, 52, 20, null, '#92400e', 0,
    'Classic cola fizz with a frosty finish. Compact, pocket-friendly and ready to use.'],
  ['Geek Bar Pulse - Strawberry Kiwi', 'Geek Bar', 'disposables', 4500, 28, 50, null, '#ec4899', 1,
    'Dual-mode display disposable with a 15,000 puff capacity and a bright strawberry-kiwi blend.'],
  ['IVG Bar Max - Mint', 'IVG', 'disposables', 3200, 33, 20, null, '#10b981', 0,
    'Clean, cooling peppermint. A smooth throat hit for smokers moving away from cigarettes.'],

  ['Voopoo Vinci 2 Pod Kit', 'Voopoo', 'pod-systems', 9800, 14, null, 5, '#7c3aed', 1,
    'Adjustable 5-40W pod mod with the GENE.TT chip, 1500mAh battery and a 5ml refillable pod.'],
  ['Vaporesso XROS 3 Mini', 'Vaporesso', 'pod-systems', 6500, 22, null, 2, '#0ea5e9', 1,
    'Slim and light with 1000mAh battery, adjustable airflow and the leak-resistant COREX mesh coil.'],
  ['Uwell Caliburn G3', 'Uwell', 'pod-systems', 7900, 18, null, 2.5, '#14b8a6', 0,
    'Thin pod system with a 900mAh battery. Excellent flavour thanks to the new ceramic-style coil.'],
  ['Smok Novo 5', 'Smok', 'pod-systems', 5800, 25, null, 2, '#f43f5e', 0,
    'Easy auto-draw pod kit with 900mAh battery and a 2ml pod. A solid starter device.'],
  ['Geekvape Aegis Boost 2', 'Geekvape', 'pod-systems', 11500, 12, null, 5, '#475569', 0,
    'Rugged IP68 waterproof and shockproof pod mod with 40W output and 5ml capacity. Built for daily carry.'],

  ['Geekvape Aegis Legend 3', 'Geekvape', 'box-mods', 18500, 8, null, null, '#1e293b', 1,
    'Dual 18650 mod rated up to 200W with a 0.96" display, IP68 build and a drop-proof shell.'],
  ['Voopoo Drag 4', 'Voopoo', 'box-mods', 22500, 6, null, null, '#b45309', 0,
    'Flagship 177W box mod with the GENE.AI 2.0 chip and an AI-tuned output profile. Takes two 18650 batteries.'],
  ['Vaporesso GEN 200', 'Vaporesso', 'box-mods', 17900, 9, null, null, '#0f766e', 0,
    'Reliable 220W dual-battery mod with the AXON chip and a large colour-coded screen.'],
  ['Smok Mag 18', 'Smok', 'box-mods', 13500, 10, null, null, '#6d28d9', 0,
    'A compact 230W dual 18650 mod with a pocket-friendly size and an intuitive three-button layout.'],

  ['Nasty Juice - Slow Blow 60ml', 'Nasty Juice', 'e-liquids', 2800, 45, 3, 60, '#f472b6', 1,
    'Kiwi, passion fruit and strawberry blended into a sweet-tart classic. 70VG / 30PG.'],
  ['Dinner Lady - Lemon Tart 60ml', 'Dinner Lady', 'e-liquids', 3200, 30, 3, 60, '#fde047', 0,
    'Zesty lemon meringue pie with buttery pastry notes. A long-standing UK favourite.'],
  ['Naked 100 - Hawaiian Pog 60ml', 'Naked 100', 'e-liquids', 3000, 26, 6, 60, '#fb923c', 0,
    'Tropical passion fruit, orange and guava over a smooth base. 70VG / 30PG.'],
  ['Pachamama - Strawberry Watermelon 60ml', 'Pachamama', 'e-liquids', 3600, 20, 3, 60, '#f87171', 0,
    'Fresh-cut strawberry with juicy watermelon. Made from real fruit extracts.'],
  ['Badal House Blend - Kulfi Falooda 30ml', 'Badal House Blend', 'e-liquids', 1900, 50, 25, 30, '#fbcfe8', 1,
    'Our signature dessert vape inspired by Lahore\'s kulfi falooda: creamy pistachio kulfi, rose syrup and vermicelli sweetness. Nicotine salt.'],
  ['Badal House Blend - Mango Lassi 30ml', 'Badal House Blend', 'e-liquids', 1900, 44, 25, 30, '#fbbf24', 1,
    'Sindhri mango blended with chilled yoghurt lassi. Smooth, sweet and refreshing for Karachi summers. Nicotine salt.'],
  ['Badal House Blend - Rooh Afza Ice 30ml', 'Badal House Blend', 'e-liquids', 1900, 38, 25, 30, '#e11d48', 0,
    'The nostalgic rose-and-herbal Ramadan sharbat taste with a gentle menthol chill. Nicotine salt.'],
  ['Badal House Blend - Karak Chai 30ml', 'Badal House Blend', 'e-liquids', 1900, 36, 25, 30, '#a16207', 0,
    'Strong dhaba-style karak chai with cardamom and a touch of condensed milk. Nicotine salt.'],

  ['Vaporesso GTX Coil 0.8 ohm (5-pack)', 'Vaporesso', 'coils-pods', 2400, 40, null, null, '#64748b', 0,
    'Mesh coils for the GTX tank and XROS-compatible pods. Mouth-to-lung friendly 0.8 ohm.'],
  ['Uwell Caliburn G Replacement Pods (2-pack)', 'Uwell', 'coils-pods', 1600, 55, null, 2, '#14b8a6', 0,
    'Genuine replacement pods for the Caliburn G, G2 and G3 series with 0.9 ohm coils.'],
  ['Voopoo PnP Coil 0.3 ohm (5-pack)', 'Voopoo', 'coils-pods', 2200, 34, null, null, '#8b5cf6', 0,
    'Plug-and-play mesh coils for Vinci, Drag and Argus devices. Rated 40-60W.'],
  ['Geekvape Z Coil 0.4 ohm (5-pack)', 'Geekvape', 'coils-pods', 2600, 29, null, null, '#334155', 0,
    'Multi-layer mesh coils for the Zeus and Aegis tanks with superb flavour.'],

  ['Samsung 25R 18650 Battery 2500mAh', 'Samsung', 'accessories', 1400, 70, null, null, '#2563eb', 1,
    'Authentic high-drain 20A battery for box mods. Sold individually with a protective case.'],
  ['Efest Slim K2 Dual Charger', 'Efest', 'accessories', 3200, 17, null, null, '#0d9488', 0,
    'Smart two-bay Li-ion charger with auto cut-off and an LED charge indicator.'],
  ['Organic Cotton Wicks Pack', 'Cotton Bacon', 'accessories', 1100, 80, null, null, '#e2e8f0', 0,
    'Pre-cut organic cotton strips for rebuilding coils. Pure, tasteless and clean.'],
  ['Silicone Drip Tip & Pod Case Set', 'Badal Gear', 'accessories', 900, 65, null, null, '#f97316', 0,
    'Colourful silicone pod protectors and replacement drip tips to keep your device spotless.'],
];

const customers = [
  ['Ahmed Raza Khan', 'ahmed.raza@example.com', '03001234567', 'Lahore', 'House 45, Street 12, Block C, Gulberg III', '1994-03-18'],
  ['Fatima Noor', 'fatima.noor@example.com', '03211234890', 'Karachi', 'Flat 402, Sea View Apartments, Clifton Block 5', '1996-07-02'],
  ['Hamza Malik', 'hamza.malik@example.com', '03331234321', 'Islamabad', 'House 23, Street 9, Sector F-10/3', '1991-11-25'],
  ['Ayesha Siddiqui', 'ayesha.siddiqui@example.com', '03451239876', 'Faisalabad', 'Street 4, Gulistan Colony, Jhang Road', '1998-01-14'],
  ['Bilal Ahmed Chaudhry', 'bilal.chaudhry@example.com', '03101237654', 'Rawalpindi', 'House 112, Block B, Satellite Town', '1989-09-09'],
  ['Usman Ghani', 'usman.ghani@example.com', '03151236543', 'Peshawar', 'House 8, Street 3, Hayatabad Phase 3, Sector N-2', '1993-05-30'],
  ['Sana Iqbal', 'sana.iqbal@example.com', '03061235432', 'Multan', 'House 7, Gulgasht Colony, Bosan Road', '1995-12-21'],
];

// [customer index, days ago, status, payment, [[product name fragment, qty], ...]]
const orders = [
  [0, 58, 'Delivered', 'cod', [['Vinci 2', 1], ['Kulfi Falooda', 2]]],
  [1, 51, 'Delivered', 'jazzcash', [['Mango Lassi', 3], ['Caliburn G Replacement', 1]]],
  [2, 44, 'Delivered', 'easypaisa', [['Aegis Legend 3', 1], ['Samsung 25R', 2]]],
  [3, 39, 'Delivered', 'cod', [['BM600 - Mango', 4]]],
  [4, 33, 'Delivered', 'bank', [['Drag 4', 1], ['PnP Coil', 2], ['Slow Blow', 1]]],
  [5, 27, 'Delivered', 'cod', [['XROS 3 Mini', 1], ['GTX Coil', 1]]],
  [6, 21, 'Dispatched', 'jazzcash', [['Karak Chai', 2], ['Rooh Afza', 2]]],
  [0, 14, 'Confirmed', 'cod', [['Geek Bar Pulse', 2]]],
  [1, 9, 'Cancelled', 'easypaisa', [['Dinner Lady', 1]]],
  [2, 5, 'Pending', 'cod', [['Elf Bar BC5000 - Blue', 2], ['Silicone Drip Tip', 1]]],
  [3, 3, 'Pending', 'jazzcash', [['Novo 5', 1], ['Kulfi Falooda', 1]]],
  [4, 1, 'Pending', 'cod', [['Efest', 1], ['Samsung 25R', 4]]],
];

// [product name fragment, customer index, rating, comment]
const reviews = [
  ['Kulfi Falooda', 0, 5, 'Bilkul asli kulfi jaisa taste hai! Delivery Lahore mein 2 din mein ho gayi.'],
  ['Kulfi Falooda', 3, 5, 'Best local flavour I have tried. Rose and pistachio balance is spot on.'],
  ['Mango Lassi', 1, 5, 'Perfect for Karachi heat. Sweet but not overpowering.'],
  ['Mango Lassi', 6, 4, 'Very smooth. I wish the 30ml bottle lasted longer.'],
  ['Vinci 2', 0, 5, 'Excellent build quality and great battery life. Genuine product with authenticity code.'],
  ['Aegis Legend 3', 2, 5, 'Dropped it twice on tiles in Islamabad and it still works fine. Solid.'],
  ['Drag 4', 4, 4, 'Powerful and the chip is brilliant. A little heavy but worth it.'],
  ['XROS 3 Mini', 5, 4, 'Light and discreet. Pods do not leak, which is rare at this price.'],
  ['BM600 - Mango', 3, 4, 'Good beginner disposable. Flavour fades slightly near the end.'],
  ['Slow Blow', 4, 5, 'Sweet and tangy, a proper all-day juice.'],
  ['Samsung 25R', 2, 5, 'Authentic cells, wrapped properly. Thank you for the safety leaflet.'],
  ['Caliburn G Replacement', 1, 4, 'Genuine pods, arrived sealed and fresh.'],
];

function seed(db, { quiet = false } = {}) {
  const exists = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (exists > 0) return false;

  const hash = (pw) => bcrypt.hashSync(pw, BCRYPT_ROUNDS);
  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, phone, city, address, dob, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertCat = db.prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)');
  const insertProd = db.prepare(
    `INSERT INTO products (category_id, name, slug, brand, description, price_pkr, stock, nicotine_mg, volume_ml, color, featured)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  db.exec('BEGIN');
  try {
    insertUser.run('Muhammad Ali (Admin)', ADMIN_EMAIL, hash(ADMIN_PASSWORD), '03001112223', 'Lahore',
      'Badal Vapes HQ, 52-B MM Alam Road, Gulberg III', '1988-04-10', 'admin');

    const customerHash = hash(DEMO_CUSTOMER_PASSWORD);
    const customerIds = customers.map(([name, email, phone, city, address, dob]) =>
      Number(insertUser.run(name, email, customerHash, phone, city, address, dob, 'customer').lastInsertRowid));

    const catId = {};
    for (const [name, slug, desc] of categories) catId[slug] = Number(insertCat.run(name, slug, desc).lastInsertRowid);

    const prodByName = [];
    for (const [name, brand, cat, price, stock, nic, vol, color, featured, desc] of products) {
      const id = Number(insertProd.run(catId[cat], name, slugify(name), brand, desc, price, stock, nic, vol, color, featured).lastInsertRowid);
      prodByName.push({ id, name, price });
    }
    // Sale items: [name fragment, old (pre-discount) price in PKR]
    const markdowns = [
      ['Elf Bar BC5000 - Blue', 4500], ['Lost Mary BM600 - Cola', 2800], ['IVG Bar Max', 3800], ['Smok Novo 5', 6900],
      ['Uwell Caliburn G3', 9200], ['Smok Mag 18', 15900], ['Dinner Lady', 3800], ['GTX Coil', 2900],
    ];
    for (const [frag, oldPrice] of markdowns) {
      const p = prodByName.find((x) => x.name.includes(frag));
      db.prepare('UPDATE products SET old_price_pkr = ? WHERE id = ?').run(oldPrice, p.id);
    }
    const find = (frag) => {
      const p = prodByName.find((x) => x.name.toLowerCase().includes(frag.toLowerCase()));
      if (!p) throw new Error('Seed product not found: ' + frag);
      return p;
    };

    const { METRO_CITIES, SHIPPING_METRO, SHIPPING_OTHER, FREE_SHIPPING_OVER, PAYMENT_METHODS } = require('./config');
    const insertOrder = db.prepare(
      `INSERT INTO orders (user_id, status, subtotal_pkr, shipping_pkr, total_pkr, payment_method,
         ship_name, ship_phone, ship_city, ship_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, name, unit_price_pkr, qty) VALUES (?, ?, ?, ?, ?)'
    );
    for (const [ci, daysAgo, status, pay, lines] of orders) {
      const c = customers[ci];
      const items = lines.map(([frag, qty]) => ({ ...find(frag), qty }));
      const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
      const shipping = subtotal >= FREE_SHIPPING_OVER ? 0 : METRO_CITIES.includes(c[3]) ? SHIPPING_METRO : SHIPPING_OTHER;
      const when = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 19).replace('T', ' ');
      const oid = Number(insertOrder.run(customerIds[ci], status, subtotal, shipping, subtotal + shipping,
        PAYMENT_METHODS[pay] ? pay : 'cod', c[0], c[2], c[3], c[4], when).lastInsertRowid);
      for (const i of items) insertItem.run(oid, i.id, i.name, i.price, i.qty);
    }

    const insertReview = db.prepare('INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)');
    for (const [frag, ci, rating, comment] of reviews) insertReview.run(find(frag).id, customerIds[ci], rating, comment);

    db.prepare('INSERT INTO messages (name, email, subject, body) VALUES (?, ?, ?, ?)').run(
      'Zainab Tariq', 'zainab.tariq@example.com', 'Delivery to Sialkot',
      'Assalam o Alaikum, do you deliver to Sialkot Cantt and how many days does it usually take?');

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (!quiet) console.log('Seeded Badal Vapes demo data (Pakistan).');
  if (generatedAdminPassword) console.log(`ADMIN_PASSWORD was not set, so a random admin password was generated for ${ADMIN_EMAIL}: ${generatedAdminPassword}`);
  return true;
}

module.exports = { seed, ADMIN_EMAIL };
