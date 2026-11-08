const { db } = require('./db');
const { METRO_CITIES, SHIPPING_METRO, SHIPPING_OTHER, FREE_SHIPPING_OVER } = require('./config');

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug,
    (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id) AS avg_rating,
    (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id) AS review_count
  FROM products p JOIN categories c ON c.id = p.category_id`;

function shippingFor(city, subtotal) {
  if (subtotal >= FREE_SHIPPING_OVER) return 0;
  return METRO_CITIES.includes(city) ? SHIPPING_METRO : SHIPPING_OTHER;
}

/** Resolve the session cart ({productId: qty}) into priced line items. */
function cartLines(cart = {}) {
  const lines = [];
  for (const [id, qty] of Object.entries(cart)) {
    const p = db.prepare(
      `SELECT p.id, p.name, p.slug, p.price_pkr, p.stock, p.color, p.image, p.active, p.category_id, c.slug AS category_slug
       FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(Number(id));
    if (!p || !p.active) continue;
    const q = Math.min(qty, p.stock);
    if (q < 1) continue;
    lines.push({ ...p, qty: q, line_total: q * p.price_pkr });
  }
  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  return { lines, subtotal };
}

module.exports = { PRODUCT_SELECT, shippingFor, cartLines };
