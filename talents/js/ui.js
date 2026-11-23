import { CONFIG } from './config.js';
import { backend } from './store.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('ar-SA-u-nu-latn') + ' ر.س';
}

export function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function waLink(number, text) {
  const n = String(number || '').replace(/\D/g, '');
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text || '')}` : '';
}

export async function chrome(active) {
  const b = await backend();
  const top = document.createElement('header');
  top.className = 'top';
  top.innerHTML = `
    <div class="wrap">
      <a class="brand" href="index.html"><span class="brand-dot"></span><span>${esc(CONFIG.brand)} <span style="opacity:.6;font-weight:400">| الكوادر</span></span></a>
      <nav>
        <a href="index.html" class="${active === 'dir' ? 'on' : ''}">تصفّح الكوادر</a>
        <a href="dashboard.html" class="${active === 'dash' ? 'on' : ''}">لوحة الكادر</a>
        <a href="${esc(CONFIG.storeUrl)}" target="_blank" rel="noopener">المتجر</a>
      </nav>
    </div>`;
  document.body.prepend(top);
  if (b.mode === 'demo') {
    const d = document.createElement('div');
    d.className = 'demo-bar';
    d.textContent = 'وضع التجربة: البيانات محفوظة في هذا المتصفح فقط حتى يتم ربط قاعدة البيانات.';
    top.after(d);
  }
  const f = document.createElement('footer');
  f.className = 'foot';
  f.innerHTML = `<div class="wrap"><span>© ${new Date().getFullYear()} ${esc(CONFIG.brand)} — منصة الكوادر</span><a href="dashboard.html">انضم ككادر</a></div>`;
  document.body.appendChild(f);
  return b;
}

export function lightbox(srcs, start = 0) {
  let i = start;
  const lb = document.createElement('div');
  lb.className = 'lb';
  lb.innerHTML = `<button class="x" aria-label="إغلاق">✕</button>${srcs.length > 1 ? '<button class="nav prev" aria-label="السابق">›</button><button class="nav next" aria-label="التالي">‹</button>' : ''}<img alt=""><div class="count"></div>`;
  const img = $('img', lb);
  const count = $('.count', lb);
  const show = () => {
    i = (i + srcs.length) % srcs.length;
    img.src = srcs[i];
    count.textContent = `${i + 1} / ${srcs.length}`;
  };
  const close = () => {
    lb.remove();
    document.removeEventListener('keydown', key);
  };
  const key = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') { i++; show(); }
    if (e.key === 'ArrowRight') { i--; show(); }
  };
  lb.addEventListener('click', (e) => {
    if (e.target === lb || e.target.classList.contains('x')) close();
    if (e.target.classList.contains('prev')) { i--; show(); }
    if (e.target.classList.contains('next')) { i++; show(); }
  });
  document.addEventListener('keydown', key);
  document.body.appendChild(lb);
  show();
}

export function modal(html) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => m.remove();
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-close]')) close();
  });
  document.body.appendChild(m);
  return { el: m, close };
}
