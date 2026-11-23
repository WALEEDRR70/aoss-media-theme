(function () {
  'use strict';

  /* AOSS Talents — storefront snippet.
     Opens the talent dashboard inside the store when the URL hash is
     #talent-dashboard, signing the talent in with their store account. */

  var API_BASE = '__API_BASE__';
  var DASH_URL = 'https://waleedrr70.github.io/aoss-media-theme/talents/dashboard.html?in=store';
  var HASH = '#talent-dashboard';
  var BOX_ID = 'aoss-talent-box';

  function S() {
    return window.salla;
  }

  function lang() {
    return (document.documentElement.lang || 'ar').slice(0, 2);
  }

  function customerToken() {
    var s = S();
    try {
      var auth = s.api.axios.defaults.headers.common.Authorization || s.api.axios.defaults.headers.Authorization;
      if (auth) return String(auth).replace(/^Bearer\s+/i, '');
    } catch (e) {}
    try {
      var tk = s.config.get('token') || (s.storage && s.storage.get && s.storage.get('token'));
      if (tk) return String(tk);
    } catch (e) {}
    return '';
  }

  function isLoggedIn() {
    try {
      return !!S().config.get('user.id');
    } catch (e) {
      return false;
    }
  }

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text) e.textContent = text;
    return e;
  }

  function close() {
    var b = document.getElementById(BOX_ID);
    if (b) b.remove();
    document.documentElement.style.overflow = '';
    if (location.hash === HASH) location.hash = '';
  }

  function shell(message) {
    close();
    var box = el('div', 'position:fixed;inset:0;z-index:99999;background:#f7f6f3;display:flex;flex-direction:column');
    box.id = BOX_ID;
    var bar = el('div', 'display:flex;align-items:center;gap:12px;padding:10px 16px;background:#0a0a0a;color:#fff;font-weight:600');
    var title = el('span', 'flex:1', lang() === 'ar' ? 'لوحة الكادر — أسس ميديا' : 'Talent dashboard — AOSS MEDIA');
    var x = el('button', 'background:rgba(255,255,255,.15);color:#fff;border:0;border-radius:999px;padding:6px 14px;cursor:pointer;font:inherit', lang() === 'ar' ? 'إغلاق' : 'Close');
    x.type = 'button';
    x.addEventListener('click', close);
    bar.appendChild(title);
    bar.appendChild(x);
    var body = el('div', 'flex:1;display:flex;align-items:center;justify-content:center;color:#6b6b6b;font-size:15px;padding:20px;text-align:center', message || '');
    box.appendChild(bar);
    box.appendChild(body);
    document.documentElement.appendChild(box);
    document.documentElement.style.overflow = 'hidden';
    return body;
  }

  function open() {
    if (!isLoggedIn()) {
      shell(lang() === 'ar' ? 'سجّل الدخول بحسابك في المتجر للمتابعة…' : 'Please sign in to continue…');
      try {
        S().event.dispatch('login::open');
      } catch (e) {}
      return;
    }
    var body = shell(lang() === 'ar' ? 'جاري فتح لوحتك…' : 'Opening your dashboard…');
    var token = customerToken();
    var store = S().config.get('store.id');
    if (!token || !store) {
      body.textContent = lang() === 'ar' ? 'تعذّر التحقق من حسابك. حدّث الصفحة وحاول مرة أخرى.' : 'Could not verify your account. Refresh and try again.';
      return;
    }
    fetch(API_BASE + '/sso/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, store: String(store) }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok || !j.customToken) throw new Error(j.error || 'sso');
          return j;
        });
      })
      .then(function (j) {
        var frame = el('iframe', 'flex:1;width:100%;border:0;background:#f7f6f3');
        frame.setAttribute('title', 'AOSS Talents');
        frame.setAttribute('allow', 'clipboard-write');
        frame.src = DASH_URL + '#sso=' + encodeURIComponent(j.customToken);
        body.replaceWith(frame);
      })
      .catch(function () {
        body.textContent = lang() === 'ar' ? 'تعذّر فتح اللوحة الآن. حاول بعد قليل.' : 'Could not open the dashboard. Please try again shortly.';
      });
  }

  function check() {
    if (location.hash === HASH) open();
  }

  function onLogin() {
    if (location.hash === HASH) setTimeout(open, 400);
  }

  function boot() {
    check();
    window.addEventListener('hashchange', check);
    try {
      S().event.on('auth::logged.in', onLogin);
    } catch (e) {}
    // Any link to #talent-dashboard (menu item, button) opens the dashboard.
    document.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[href$="' + HASH + '"]') : null;
      if (!a) return;
      e.preventDefault();
      if (location.hash !== HASH) location.hash = HASH;
      else open();
    });
  }

  if (window.salla && typeof window.salla.onReady === 'function') window.salla.onReady(boot);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
