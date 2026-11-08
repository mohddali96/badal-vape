# Badal Vapes - Pakistan vape store (Web Engineering 2221)

A database-driven, multi-page e-commerce web application for a fictional Pakistani vape retailer.
All prices are in **PKR**, and all seeded customers, cities, phone numbers and addresses are Pakistani (and fictional).

## Tech stack

| Layer | Choice |
|---|---|
| Server | Node.js (>= 22.13) + Express 4 |
| Views | EJS server-side templates (semantic HTML5) |
| Database | SQLite via Node's built-in `node:sqlite` (relational, foreign keys, constraints) |
| Auth | bcrypt-hashed passwords, server-side sessions stored in SQLite, role-based access (customer / admin) |
| Security | Helmet (CSP, nosniff, frame-ancestors), CSRF tokens, parameterised SQL, output escaping, login throttling, session regeneration |
| Front end | Hand-written responsive CSS, vanilla JavaScript (progressive enhancement), WCAG-minded accessibility |
| Uploads | multer (memory storage), file-signature validation, random filenames |
| Tests | `node:test` - 44 automated test cases (TC-01 to TC-44) |

## Run locally

```bash
npm install
npm start            # http://localhost:3000
npm test             # runs the automated test plan
```

The database (`data/badal.db`) is created and seeded automatically on first start. Delete the file to reseed.

Demo accounts are defined in [`src/seed.js`](src/seed.js). The admin account is `admin@badalvapes.pk`; set the `ADMIN_PASSWORD` environment variable to choose its password.
All seeded customers share one demo password, also defined in `src/seed.js` (override it with `DEMO_CUSTOMER_PASSWORD`).
The known demo passwords are used only outside production. With `NODE_ENV=production`, any password you do not set is generated randomly (the generated admin password is printed once in the start-up log).

## Features

**Customers:** age gate (18+), browse / search / filter / sort / paginate products, product details with ratings, reviews (create, edit, delete), cart, checkout with Pakistani cities, delivery fees (Rs 250 metro / Rs 350 other / free over Rs 15,000) and payment methods (COD, JazzCash, Easypaisa, bank transfer), order history, order cancellation, profile and password change, contact form.

**Admin (`/admin`):** dashboard (revenue, orders by status, top cities, low stock), product CRUD with **photo upload** (JPG / PNG / WebP up to 3 MB, instant preview, replace or remove) and optional sale pricing (old price + discount badge), order management (status workflow with stock restoration on cancellation), customers list, customer messages.

## Project structure

```
server.js            App factory + startup
src/config.js        Business rules (cities, shipping, payments)
src/db.js            Schema + transaction helper
src/seed.js          Pakistani demo data
src/seed-images.js   Attaches the bundled demo photos to seeded products (runs once per database)
seed-images/         Demo product photographs (Creative Commons) + manifest and credits
src/middleware.js    CSRF, flash, auth guards, age gate, rate limiter
src/routes/*.js      shop, auth, cart/checkout, account, admin
views/               EJS templates
public/              CSS, JS, images
tests/               Automated tests
```

## Deploying (Render.com, free tier)

1. Push this folder to a GitHub repository.
2. In Render choose **New > Blueprint** and select the repo. `render.yaml` configures everything.
3. Set `ADMIN_PASSWORD` (the blueprint generates `SESSION_SECRET` for you).
4. Open the generated `https://<name>.onrender.com` URL and put it in your report.

Note: Render's free tier has an ephemeral disk, so the SQLite file resets when the service restarts and is re-seeded automatically.
For permanent data, attach a persistent disk and point both `DB_PATH` and `UPLOAD_DIR` at it (uploaded photos live on disk, so they are lost on restart without a persistent disk).

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | 3000 |
| `NODE_ENV` | Set to `production` when deployed | - |
| `SESSION_SECRET` | Signs session cookies | random per start |
| `ADMIN_PASSWORD` | Password of the seeded admin | demo value in `src/seed.js` |
| `DB_PATH` | SQLite file location | `data/badal.db` |
| `UPLOAD_DIR` | Where product photos are stored | `data/uploads` |

## Photos and credits

The product and banner photos are real Creative Commons photographs (found through Openverse, hosted on Flickr by their authors). They are cropped for each product and credited on the `/credits` page, as their licences require (CC BY 2.0 or CC BY-SA 2.0). They show similar hardware and are stand-ins for the items named in the shop. Photos you upload in the admin area are stored in `UPLOAD_DIR`.

On first start the app copies one photo per product into `UPLOAD_DIR`. If you already had a database from an earlier version, the photos are attached automatically to the existing seeded products the next time the app starts.

## Compliance note

The shop contains an age gate, an 18+ date-of-birth check at registration, an age confirmation at checkout, and a nicotine health warning on every page.
It is a coursework project. The business and its data are fictional.
