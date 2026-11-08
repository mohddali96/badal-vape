// Test environment: in-memory database, fast bcrypt, high login limit.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.BCRYPT_ROUNDS = '4';
process.env.LOGIN_MAX_ATTEMPTS = '1000';
process.env.ADMIN_PASSWORD = 'Admin@2026';
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), 'badal-test-uploads-' + process.pid);

const { createApp } = require('../server');

async function startServer() {
  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

/** Minimal browser: keeps cookies, follows no redirects automatically, tracks CSRF token. */
class Client {
  constructor(base) { this.base = base; this.cookies = {}; this.csrf = ''; }

  _store(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(c)) delete this.cookies[name]; else this.cookies[name] = value;
    }
  }

  async request(method, path, { form, json, multipart, headers = {} } = {}) {
    const h = { ...headers };
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    let body;
    if (form) {
      h['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    } else if (multipart) {
      body = multipart; // fetch sets the multipart boundary header itself
    } else if (json) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(json);
    }
    const res = await fetch(this.base + path, { method, headers: h, body, redirect: 'manual' });
    this._store(res);
    const text = await res.text();
    const m = text.match(/name="csrf-token" content="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, text, location: res.headers.get('location'), headers: res.headers };
  }

  get(path) { return this.request('GET', path); }

  /** POST multipart/form-data (fields + optional file) including the CSRF token. */
  postMultipart(path, fields = {}, file, { csrf = this.csrf } = {}) {
    const fd = new FormData();
    if (csrf) fd.append('_csrf', csrf);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (file) fd.append('image', new Blob([file.data], { type: file.type }), file.name);
    return this.request('POST', path, { multipart: fd });
  }

  /** POST a form including the current CSRF token. */
  post(path, form = {}) { return this.request('POST', path, { form: { _csrf: this.csrf, ...form } }); }

  async verifyAge() { await this.get('/'); return this.post('/age-verify', {}); }

  async login(email, password) {
    await this.get('/login');
    const res = await this.post('/login', { email, password, next: '/' });
    await this.get('/'); // the session is regenerated on login, so pick up the new CSRF token like a browser would
    return res;
  }
}

async function newClient(base) { const c = new Client(base); await c.get('/'); return c; }

const ADMIN = { email: 'admin@badalvapes.pk', password: 'Admin@2026' };
const CUSTOMER = { email: 'ahmed.raza@example.com', password: 'Vape@2026' };

module.exports = { startServer, Client, newClient, ADMIN, CUSTOMER };
