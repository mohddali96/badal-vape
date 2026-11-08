/* Badal Vapes - progressive enhancement. Every feature also works without JavaScript. */
(function () {
  'use strict';
  document.documentElement.classList.add('js');

  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';

  /* ---------- Toasts ---------- */
  function toast(message, isError) {
    var region = document.getElementById('toast-region');
    if (!region) return;
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' toast--error' : '');
    el.textContent = message;
    region.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  /* ---------- Mobile navigation ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  /* ---------- Age gate (no page reload) ---------- */
  var gate = document.getElementById('age-gate');
  var ageForm = document.getElementById('age-form');
  if (gate && ageForm) {
    var yes = ageForm.querySelector('button');
    if (yes) yes.focus();
    ageForm.addEventListener('submit', function (e) {
      e.preventDefault();
      fetch('/age-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ remember: !!(document.getElementById('age-remember') || {}).checked })
      }).then(function (r) {
        if (!r.ok) throw new Error('failed');
        gate.remove();
        document.body.classList.remove('gate-open');
        var main = document.getElementById('main');
        if (main) main.focus();
      }).catch(function () { ageForm.submit(); });
    });
  }

  /* ---------- Add to cart without reloading ---------- */
  document.querySelectorAll('form.js-add-to-cart').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      fetch('/cart/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'X-Requested-With': 'fetch' },
        body: JSON.stringify(data)
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res.ok) {
          document.querySelectorAll('.cart-count').forEach(function (c) { c.textContent = res.count; });
        }
        toast(res.message, !res.ok);
      }).catch(function () { form.submit(); });
    });
  });

  /* ---------- Live product filter on the shop page ---------- */
  var search = document.getElementById('q');
  var grid = document.getElementById('product-grid');
  var noMatch = document.getElementById('no-live-match');
  if (search && grid) {
    search.addEventListener('input', function () {
      var term = search.value.trim().toLowerCase();
      var shown = 0;
      grid.querySelectorAll('.product-card').forEach(function (card) {
        var match = !term || card.getAttribute('data-name').indexOf(term) !== -1;
        card.hidden = !match;
        if (match) shown++;
      });
      if (noMatch) noMatch.hidden = shown !== 0;
    });
  }
  ['category', 'sort'].forEach(function (id) {
    var el = document.getElementById(id);
    var form = document.getElementById('filter-form');
    if (el && form) el.addEventListener('change', function () { form.submit(); });
  });

  /* ---------- Product photo: instant preview + size/type check ---------- */
  document.querySelectorAll('input[type=file][data-preview]').forEach(function (input) {
    var box = document.getElementById(input.getAttribute('data-preview'));
    var maxBytes = Number(input.getAttribute('data-max-mb') || 3) * 1024 * 1024;
    var original = box ? box.innerHTML : '';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      setError(input, '');
      if (!file) { if (box) box.innerHTML = original; return; }
      if (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) === -1) {
        setError(input, 'Please choose a JPG, PNG or WebP image.');
        input.value = '';
        return;
      }
      if (file.size > maxBytes) {
        setError(input, 'That image is larger than ' + (maxBytes / 1048576) + ' MB.');
        input.value = '';
        return;
      }
      if (box) {
        var img = document.createElement('img');
        img.alt = 'Preview of the selected photo';
        img.src = URL.createObjectURL(file);
        box.innerHTML = '';
        box.appendChild(img);
      }
    });
  });

  /* ---------- Confirm destructive actions ---------- */
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  /* ---------- Client-side form validation (server still re-validates) ---------- */
  var PK_MOBILE = /^(?:(?:\+|00)?92[-\s]?|0)?3\d{2}[-\s]?\d{7}$/;

  function setError(field, message) {
    var wrap = field.closest('.field') || field.parentElement;
    var id = field.id + '-js-msg';
    var existing = document.getElementById(id);
    if (!message) {
      if (existing) existing.remove();
      field.removeAttribute('aria-invalid');
      wrap.classList.remove('field--error');
      return;
    }
    if (!existing) {
      existing = document.createElement('p');
      existing.id = id;
      existing.className = 'field__error';
      wrap.appendChild(existing);
    }
    existing.textContent = message;
    field.setAttribute('aria-invalid', 'true');
    wrap.classList.add('field--error');
  }

  function check(field, form) {
    var v = field.value.trim();
    if (field.type === 'checkbox') return field.required && !field.checked ? 'Please tick this box to continue.' : '';
    if (field.required && !v) return 'This field is required.';
    if (!v) return '';
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Enter a valid email address.';
    if (field.hasAttribute('data-pk-mobile') && !PK_MOBILE.test(v)) return 'Enter a valid Pakistani mobile number, e.g. 0300 1234567.';
    if (field.minLength > 0 && v.length < field.minLength) return 'Please enter at least ' + field.minLength + ' characters.';
    if (field.id === 'password' && form.querySelector('[data-strength]') && !(/[A-Za-z]/.test(v) && /\d/.test(v))) return 'Include at least one letter and one number.';
    if (field.id === 'confirm') {
      var pw = form.querySelector('#password');
      if (pw && pw.value !== field.value) return 'Passwords do not match.';
    }
    if (field.type === 'date' && field.id === 'dob') {
      var dob = new Date(v), now = new Date();
      var age = now.getFullYear() - dob.getFullYear();
      var m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
      if (isNaN(age) || age < 18) return 'You must be 18 or older.';
    }
    return '';
  }

  document.querySelectorAll('form[data-validate]').forEach(function (form) {
    var fields = form.querySelectorAll('input:not([type=hidden]):not([readonly]), select, textarea');
    fields.forEach(function (f) {
      f.addEventListener('blur', function () { setError(f, check(f, form)); });
      f.addEventListener('input', function () { if (f.getAttribute('aria-invalid')) setError(f, check(f, form)); });
    });
    form.addEventListener('submit', function (e) {
      var firstBad = null;
      fields.forEach(function (f) {
        var msg = check(f, form);
        setError(f, msg);
        if (msg && !firstBad) firstBad = f;
      });
      if (firstBad) { e.preventDefault(); firstBad.focus(); }
    });
  });

  /* ---------- Password strength meter ---------- */
  var pw = document.querySelector('[data-strength]');
  var meter = document.getElementById('strength');
  if (pw && meter) {
    pw.addEventListener('input', function () {
      var v = pw.value, score = 0;
      if (v.length >= 8) score++;
      if (/[A-Za-z]/.test(v) && /\d/.test(v)) score++;
      if (v.length >= 12 || /[^A-Za-z0-9]/.test(v)) score++;
      var labels = ['', 'Weak password', 'Okay password', 'Strong password'];
      var cls = ['', 'weak', 'ok', 'strong'];
      meter.textContent = v ? labels[score] || 'Weak password' : '';
      meter.className = 'strength' + (v ? ' strength--' + (cls[score] || 'weak') : '');
    });
  }

  /* ---------- Live delivery estimate at checkout ---------- */
  var checkout = document.getElementById('checkout-form');
  if (checkout) {
    var citySel = checkout.querySelector('#city');
    var subtotal = Number(checkout.dataset.subtotal);
    var metros = checkout.dataset.metro.split(',');
    var fmt = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
    var update = function () {
      var ship = subtotal >= Number(checkout.dataset.freeOver) ? 0
        : metros.indexOf(citySel.value) !== -1 ? Number(checkout.dataset.shipMetro) : Number(checkout.dataset.shipOther);
      document.getElementById('ship-cost').textContent = ship === 0 ? 'Free' : 'Rs ' + fmt.format(ship);
      document.getElementById('order-total').textContent = 'Rs ' + fmt.format(subtotal + ship);
    };
    citySel.addEventListener('change', update);
    update();
  }
})();
