const { MIN_AGE } = require('./config');

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;

// Pakistani mobile: 03XX-XXXXXXX, +92 3XX XXXXXXX, 0092 3XX XXXXXXX
const PK_MOBILE = /^(?:(?:\+|00)?92[-\s]?|0)?3\d{2}[-\s]?\d{7}$/;
const isPkMobile = (v) => PK_MOBILE.test(v);

/** Normalise any accepted Pakistani mobile format to 03XXXXXXXXX. */
function normalisePhone(v) {
  const digits = v.replace(/[^\d]/g, '');
  const local = digits.replace(/^(0092|92)/, '').replace(/^0/, '');
  return '0' + local;
}

/** At least 8 chars with a letter and a number. */
const isStrongPassword = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 72 && /[A-Za-z]/.test(v) && /\d/.test(v);

function ageFromDob(dobStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dobStr)) return null;
  const dob = new Date(dobStr + 'T00:00:00Z');
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

const isAdult = (dobStr) => {
  const age = ageFromDob(dobStr);
  return age !== null && age >= MIN_AGE && age < 120;
};

const toInt = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v !== 'string' || !/^-?\d+$/.test(v.trim())) return NaN;
  return parseInt(v.trim(), 10);
};

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/** Only allow same-site relative redirects. */
const safeNext = (v) => (typeof v === 'string' && /^\/(?![/\\])/.test(v) ? v : '/');

module.exports = {
  clean, isEmail, isPkMobile, normalisePhone, isStrongPassword,
  ageFromDob, isAdult, toInt, slugify, safeNext,
};
