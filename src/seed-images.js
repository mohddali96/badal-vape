// Attaches the bundled demo photos (Creative Commons licensed, see /credits) to the seeded products.
// Runs once per database; each product gets its own copy of its photo so deleting one never affects another.
const fs = require('node:fs');
const path = require('node:path');
const { UPLOAD_DIR } = require('./uploads');

const DIR = path.join(__dirname, '..', 'seed-images');

function attachSeedImages(db) {
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'seed_images_v1'").get()) return 0;
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')); } catch { return 0; }

  let attached = 0;
  for (const [slug, { file }] of Object.entries(manifest)) {
    const product = db.prepare('SELECT id, image FROM products WHERE slug = ?').get(slug);
    const src = path.join(DIR, file);
    if (!product || product.image || !fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(UPLOAD_DIR, file));
    db.prepare('UPDATE products SET image = ? WHERE id = ?').run(file, product.id);
    attached++;
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('seed_images_v1', 'done')").run();
  return attached;
}

module.exports = { attachSeedImages };
