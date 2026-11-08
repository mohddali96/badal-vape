const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

const config = require('./src/config');
const { db } = require('./src/db');
const { seed } = require('./src/seed');
const { attachSeedImages } = require('./src/seed-images');
const createStore = require('./src/session-store');
const mw = require('./src/middleware');
const { UPLOAD_DIR } = require('./src/uploads');

const isProd = process.env.NODE_ENV === 'production';

const pkr = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

function createApp() {
  seed(db, { quiet: process.env.NODE_ENV === 'test' });
  attachSeedImages(db);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1); // behind the host's HTTPS proxy (Render, Railway, ...)
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
  }));

  app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));
  // Admin-uploaded product photos (names are random UUIDs, so they can be cached for a long time).
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: isProd ? '30d' : 0, index: false, dotfiles: 'deny' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(express.json({ limit: '20kb' }));

  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (isProd) console.warn('WARNING: SESSION_SECRET is not set; using a random secret (sessions reset on restart).');
    secret = crypto.randomBytes(32).toString('hex');
  }
  app.use(session({
    name: 'badal.sid',
    secret,
    store: createStore(session, db),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd ? 'auto' : false, maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));

  app.locals.config = config;
  app.locals.pkr = (n) => 'Rs ' + pkr.format(n);
  app.locals.fmtDate = (s) => (s ? dateFmt.format(new Date(String(s).replace(' ', 'T') + 'Z')) : '');
  app.locals.paymentLabel = (k) => config.PAYMENT_METHODS[k] || k;
  app.locals.stars = (n) => '★'.repeat(Math.round(n || 0)) + '☆'.repeat(5 - Math.round(n || 0));

  app.use(mw.flash);
  app.use(mw.attachUser);
  app.use(mw.ageGate);
  app.use((req, res, next) => { res.locals.currentPath = req.path; next(); });
  app.use(mw.csrf); // last, so even its 403 page has every layout variable

  app.use('/', require('./src/routes/shop'));
  app.use('/', require('./src/routes/auth'));
  app.use('/', require('./src/routes/cart'));
  app.use('/account', require('./src/routes/account'));
  app.use('/admin', require('./src/routes/admin'));

  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Page not found', code: 404, message: 'We could not find the page you were looking for.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Errors raised by the body parsers happen before the layout middleware has run, so give the template safe defaults.
    res.locals.csrfToken = res.locals.csrfToken || '';
    res.locals.user = res.locals.user || null;
    res.locals.cartCount = res.locals.cartCount || 0;
    res.locals.flash = res.locals.flash || [];
    res.locals.showAgeGate = false;
    res.locals.currentPath = req.path;

    const status = err.status || err.statusCode;
    if (status >= 400 && status < 500) { // client mistakes (malformed JSON, oversized body) are not server errors
      return res.status(status).render('error', {
        title: status === 413 ? 'Request too large' : 'Bad request', code: status,
        message: status === 413 ? 'That request was too large to process.' : 'The request could not be understood. Please go back and try again.',
      });
    }
    console.error(err);
    res.status(500).render('error', { title: 'Something went wrong', code: 500, message: 'An unexpected error occurred. Please try again shortly.' });
  });

  return app;
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`Badal Vapes running on http://localhost:${port}`));
}

module.exports = { createApp };
