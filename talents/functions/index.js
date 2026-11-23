/**
 * AOSS Talents API — one HTTP function, deployed as `api`.
 *
 * Routes
 *   GET  /img/:id          serve a talent image stored in Firestore (public)
 *   POST /webhook          Salla app webhooks (tokens, install/uninstall, order.created)
 *   POST /sync             push a talent profile to Salla as a product (talent owner or admin)
 *   POST /sso/store        sign a store customer into the talent dashboard (Salla storefront token)
 *   POST /sso/embedded     sign the merchant into the admin page inside the Salla dashboard
 *
 * Environment
 *   SALLA_CLIENT_ID, SALLA_CLIENT_SECRET   app keys (Partners portal → App Keys)
 *   SALLA_WEBHOOK_SECRET                   webhook secret (Partners portal → Webhooks)
 *   SALLA_APP_ID                           numeric app id (for embedded token introspection)
 *   PUBLIC_BASE                            public URL of this function, e.g. https://api-xxxx.run.app
 */
const functions = require('@google-cloud/functions-framework');
const crypto = require('crypto');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const ADMIN_API = 'https://api.salla.dev/admin/v2';
const STORE_API = 'https://api.salla.dev/store/v1';
const TOKEN_URL = 'https://accounts.salla.sa/oauth2/token';
const INTROSPECT_URL = 'https://api.salla.dev/exchange-authority/v1/introspect';
const CATEGORY_NAME = 'الكوادر';
const MAX_SALLA_IMAGES = 10;

const ALLOWED_ORIGINS = [/^https:\/\/waleedrr70\.github\.io$/, /^https:\/\/([a-z0-9-]+\.)*aoss\.shop$/, /^https:\/\/([a-z0-9-]+\.)*salla\.sa$/, /^http:\/\/localhost(:\d+)?$/];

const CAT_LABELS = { model: 'مودل', makeup: 'ميكب آرتست', hair: 'هير آرتست', crew: 'كوادر' };
const UNIT_LABELS = { hour: 'ساعة', session: 'جلسة', day: 'يوم', event: 'مناسبة' };

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cors(req, res) {
  const origin = req.get('origin') || '';
  if (ALLOWED_ORIGINS.some((r) => r.test(origin))) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Max-Age', '3600');
  }
}

async function firebaseUser(req) {
  const m = (req.get('authorization') || '').match(/^Bearer (.+)$/);
  if (!m) throw new HttpError(401, 'missing token');
  try {
    return await admin.auth().verifyIdToken(m[1]);
  } catch (e) {
    throw new HttpError(401, 'invalid token');
  }
}

function isAdminClaims(u) {
  return u.admin === true || (u.email_verified && u.email === 'info@aoss.media');
}

function categoryLabel(t) {
  return t.category === 'crew' && t.crewRole ? t.crewRole : CAT_LABELS[t.category] || '';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function imageUrl(ref) {
  if (!ref) return '';
  if (String(ref).startsWith('fs-img:')) return `${process.env.PUBLIC_BASE}/img/${encodeURIComponent(ref.slice(7))}.webp`;
  return /^https?:\/\//.test(ref) ? ref : '';
}

function hash(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Salla tokens                                                        */
/* ------------------------------------------------------------------ */

async function saveTokens(merchant, data) {
  await db.doc(`merchants/${merchant}`).set(
    {
      merchant: String(merchant),
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expires: Number(data.expires) * 1000 || Date.now() + 13 * 864e5,
      scope: data.scope || '',
      active: true,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

/** Return a valid access token, refreshing it (once, under a lock) when it is close to expiry. */
async function accessToken(merchant) {
  const ref = db.doc(`merchants/${merchant}`);
  const snap = await ref.get();
  if (!snap.exists || !snap.data().active) throw new HttpError(409, 'store not connected');
  const m = snap.data();
  if (m.expires > Date.now() + 864e5) return m.accessToken;

  // Refresh tokens are single-use: take a short lock so parallel calls don't burn it twice.
  const gotLock = await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data();
    if (cur.expires > Date.now() + 864e5) return false;
    if (cur.refreshLock && cur.refreshLock > Date.now() - 60e3) return false;
    tx.update(ref, { refreshLock: Date.now() });
    return true;
  });
  if (!gotLock) {
    await new Promise((r) => setTimeout(r, 2500));
    return (await ref.get()).data().accessToken;
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: m.refreshToken,
    client_id: process.env.SALLA_CLIENT_ID,
    client_secret: process.env.SALLA_CLIENT_SECRET,
  });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    await ref.update({ refreshLock: 0, lastError: `refresh failed ${r.status}` });
    throw new HttpError(502, 'token refresh failed');
  }
  await ref.update({
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expires: Date.now() + (Number(j.expires_in) || 14 * 86400) * 1000,
    refreshLock: 0,
    updatedAt: Date.now(),
  });
  return j.access_token;
}

async function salla(merchant, method, path, body, { multipart } = {}) {
  const token = await accessToken(merchant);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Language': 'ar' };
  let payload;
  if (multipart) {
    payload = new FormData();
    Object.entries(body).forEach(([k, v]) => payload.append(k, String(v)));
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(ADMIN_API + path, { method, headers, body: payload });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const fields = j.error && j.error.fields ? JSON.stringify(j.error.fields) : '';
    throw new Error(`Salla ${method} ${path} → ${r.status} ${(j.error && j.error.message) || ''} ${fields}`.trim());
  }
  return j;
}

async function activeMerchants() {
  const s = await db.collection('merchants').where('active', '==', true).get();
  return s.docs.map((d) => d.id);
}

/* ------------------------------------------------------------------ */
/* talent → Salla product                                              */
/* ------------------------------------------------------------------ */

function offersOf(t) {
  const services = (t.services || []).filter((s) => s.name && +s.price > 0).map((s) => ({
    id: s.id,
    label: `${s.name} — ${s.price} ر.س / ${UNIT_LABELS[s.unit] || 'وحدة'}`,
    price: +s.price,
  }));
  const packages = (t.packages || []).filter((p) => p.name && +p.price > 0).map((p) => ({
    id: p.id,
    label: `باقة ${p.name}${p.hours ? ` (${p.hours} ساعات)` : ''} — ${p.price} ر.س`,
    price: +p.price,
  }));
  return [...services, ...packages];
}

function describe(t) {
  const parts = [];
  if (t.headline) parts.push(`<p><strong>${escapeHtml(t.headline)}</strong></p>`);
  if (t.bio) parts.push(`<p>${escapeHtml(t.bio).replace(/\n/g, '<br>')}</p>`);
  const a = t.attributes || {};
  const facts = [
    a.height && `الطول: ${a.height} سم`,
    a.size && `المقاس: ${a.size}`,
    a.experience && `سنوات الخبرة: ${a.experience}`,
    a.specialties && `مجالات التميّز: ${a.specialties}`,
    (t.cities || []).length && `المدن: ${t.cities.join('، ')}`,
  ].filter(Boolean);
  if (facts.length) parts.push(`<ul>${facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`);
  if ((t.services || []).length) {
    parts.push('<h3>الخدمات</h3><ul>' + t.services.map((s) => `<li>${escapeHtml(s.name)}: ${s.price} ر.س / ${UNIT_LABELS[s.unit] || ''}${s.notes ? ' — ' + escapeHtml(s.notes) : ''}</li>`).join('') + '</ul>');
  }
  if ((t.packages || []).length) {
    parts.push('<h3>الباقات</h3><ul>' + t.packages.map((p) => `<li>${escapeHtml(p.name)}: ${p.price} ر.س${p.hours ? ` — ${p.hours} ساعات` : ''}${(p.includes || []).length ? ' (' + p.includes.map(escapeHtml).join('، ') + ')' : ''}</li>`).join('') + '</ul>');
  }
  parts.push('<p>اختر الخدمة أو الباقة وتاريخ الحجز ثم أكمل الطلب. للخدمات بالساعة اجعل الكمية = عدد الساعات. يؤكَّد الحجز بعد تواصل فريق أسس ميديا.</p>');
  return parts.join('');
}

async function ensureCategory(merchant) {
  const ref = db.doc(`merchants/${merchant}`);
  const m = (await ref.get()).data() || {};
  if (m.categoryId) return m.categoryId;
  const found = await salla(merchant, 'GET', `/categories/search?keyword=${encodeURIComponent(CATEGORY_NAME)}`).catch(() => null);
  let id = found && (found.data || []).find((c) => c.name === CATEGORY_NAME)?.id;
  if (!id) {
    const created = await salla(merchant, 'POST', '/categories', { name: CATEGORY_NAME, status: 'active' });
    id = created.data.id;
  }
  await ref.update({ categoryId: id });
  return id;
}

async function syncTalentToMerchant(t, merchant) {
  const link = (t.salla && t.salla[merchant]) || {};
  const approved = t.status === 'approved';
  const offers = offersOf(t);

  if (!approved || !offers.length) {
    if (link.productId) await salla(merchant, 'POST', `/products/${link.productId}/status`, { status: 'hidden' }).catch(() => {});
    return { ...link, hidden: true, syncedAt: Date.now() };
  }

  const base = Math.min(...offers.map((o) => o.price));
  const categoryId = await ensureCategory(merchant);
  const product = {
    name: `${t.name} — ${categoryLabel(t)}`.slice(0, 100),
    price: base,
    product_type: 'service',
    description: describe(t),
    categories: [categoryId],
    unlimited_quantity: true,
    require_shipping: false,
    enable_note: true,
    subtitle: (t.headline || '').slice(0, 80),
  };

  let productId = link.productId;
  let url = link.url;
  if (productId) {
    const r = await salla(merchant, 'PUT', `/products/${productId}`, product).catch(async (e) => {
      if (/→ 404/.test(e.message)) return null; // deleted in Salla: recreate
      throw e;
    });
    if (!r) productId = null;
    else url = r.data && r.data.url ? r.data.url : url;
  }
  if (!productId) {
    const r = await salla(merchant, 'POST', '/products', { ...product, status: 'sale' });
    productId = r.data.id;
    url = r.data.url;
    link.optionsSig = null;
    link.imagesSig = null;
    link.optionIds = [];
    link.imageIds = [];
  }

  // Options: service/package (priced), date, time, city. Rebuilt only when they change.
  const cities = (t.cities || []).slice(0, 30);
  const optionsSig = hash({ offers, base, cities });
  let valueMap = link.valueMap || {};
  if (link.optionsSig !== optionsSig) {
    for (const id of link.optionIds || []) await salla(merchant, 'DELETE', `/products/options/${id}`).catch(() => {});
    const optionIds = [];
    valueMap = {};
    const o1 = await salla(merchant, 'POST', `/products/${productId}/options`, {
      name: 'الخدمة أو الباقة',
      type: 'radio',
      display_type: 'text',
      required: true,
      values: offers.map((o, i) => ({ name: o.label.slice(0, 100), price: o.price - base, is_default: i === 0 })),
    });
    optionIds.push(o1.data.id);
    (o1.data.values || []).forEach((v, i) => { if (offers[i]) valueMap[offers[i].id] = v.id; });
    const o2 = await salla(merchant, 'POST', `/products/${productId}/options`, { name: 'تاريخ الحجز', type: 'date', required: true });
    optionIds.push(o2.data.id);
    const o3 = await salla(merchant, 'POST', `/products/${productId}/options`, { name: 'وقت البدء', type: 'time', required: true });
    optionIds.push(o3.data.id);
    if (cities.length) {
      const o4 = await salla(merchant, 'POST', `/products/${productId}/options`, {
        name: 'المدينة',
        type: 'radio',
        display_type: 'text',
        required: true,
        values: cities.map((c, i) => ({ name: c, price: 0, is_default: i === 0 })),
      });
      optionIds.push(o4.data.id);
    }
    link.optionIds = optionIds;
    link.offerOptionId = o1.data.id;
    link.dateOptionId = o2.data.id;
    link.timeOptionId = o3.data.id;
    link.optionsSig = optionsSig;
  }

  // Images: cover/avatar first, then gallery, max 10 in Salla.
  const refs = [t.cover, t.avatar, ...(t.gallery || [])].filter(Boolean).filter((r, i, a) => a.indexOf(r) === i).slice(0, MAX_SALLA_IMAGES);
  const imagesSig = hash(refs);
  if (link.imagesSig !== imagesSig) {
    for (const id of link.imageIds || []) await salla(merchant, 'DELETE', `/products/images/${id}`).catch(() => {});
    const imageIds = [];
    for (let i = 0; i < refs.length; i++) {
      const original = imageUrl(refs[i]);
      if (!original) continue;
      const r = await salla(merchant, 'POST', `/products/${productId}/images`, { original, main: i === 0 ? 'true' : 'false', sort: i + 1, alt: t.name }, { multipart: true }).catch((e) => {
        console.warn('image attach failed', e.message);
        return null;
      });
      if (r && r.data && r.data.id) imageIds.push(r.data.id);
    }
    link.imageIds = imageIds;
    link.imagesSig = imagesSig;
  }

  await salla(merchant, 'POST', `/products/${productId}/status`, { status: 'sale' }).catch(() => {});
  return { ...link, productId, url: url || '', valueMap, hidden: false, syncedAt: Date.now(), error: null };
}

async function syncTalent(uid) {
  const ref = db.doc(`talents/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, 'talent not found');
  const t = snap.data();
  const merchants = await activeMerchants();
  const out = {};
  for (const m of merchants) {
    try {
      out[m] = await syncTalentToMerchant(t, m);
    } catch (e) {
      console.error('sync failed', uid, m, e.message);
      out[m] = { ...((t.salla && t.salla[m]) || {}), error: e.message.slice(0, 500), syncedAt: Date.now() };
    }
  }
  await ref.update({ salla: out });
  return out;
}

/* ------------------------------------------------------------------ */
/* webhooks                                                            */
/* ------------------------------------------------------------------ */

function verifySignature(req) {
  const secret = process.env.SALLA_WEBHOOK_SECRET;
  const strategy = (req.get('x-salla-security-strategy') || 'signature').toLowerCase();
  if (!secret) return false;
  if (strategy === 'token') {
    const got = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    return got.length === secret.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret));
  }
  const sig = req.get('x-salla-signature') || '';
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.from('')).digest('hex');
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function optionText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(optionText).filter(Boolean).join('، ');
  if (typeof v === 'object') return v.name || v.value || '';
  return String(v);
}

async function onOrderCreated(merchant, order) {
  const items = order.items || [];
  for (const it of items) {
    const productId = String((it.product && it.product.id) || it.product_id || '');
    if (!productId) continue;
    const s = await db.collection('talents').where(`salla.${merchant}.productId`, '==', Number(productId)).limit(1).get();
    const s2 = s.empty ? await db.collection('talents').where(`salla.${merchant}.productId`, '==', productId).limit(1).get() : s;
    if (s2.empty) continue;
    const t = s2.docs[0].data();
    const opts = {};
    (it.options || []).forEach((o) => { opts[o.name] = optionText(o.value); });
    const total = Number(it.amounts && it.amounts.total && it.amounts.total.amount) || 0;
    const id = `salla-${merchant}-${order.id}-${it.id}`;
    const c = order.customer || {};
    const booking = {
      id,
      talentId: t.uid,
      talentName: t.name,
      item: { kind: 'salla', id: productId, name: opts['الخدمة أو الباقة'] || it.name || '', unit: 'order', price: total },
      qty: Number(it.quantity) || 1,
      total,
      deposit: 0,
      date: opts['تاريخ الحجز'] || '',
      time: opts['وقت البدء'] || '',
      city: opts['المدينة'] || '',
      customer: { name: [c.first_name, c.last_name].filter(Boolean).join(' ') },
      notes: [it.notes, order.notes].filter(Boolean).join('\n'),
      status: 'new',
      paid: true,
      source: 'salla',
      merchant: String(merchant),
      orderId: order.id,
      orderRef: order.reference_id || '',
      createdAt: Date.now(),
    };
    await db.doc(`bookings/${id}`).set(booking, { merge: true });
    await db.doc(`contacts/${id}`).set({
      name: booking.customer.name,
      phone: `${c.mobile_code || ''}${c.mobile || ''}`.replace(/\s/g, ''),
      email: c.email || '',
      talentId: t.uid,
      createdAt: booking.createdAt,
    }, { merge: true });
  }
}

async function handleWebhook(req, res) {
  if (!verifySignature(req)) throw new HttpError(401, 'bad signature');
  const { event, merchant, data } = req.body || {};
  switch (event) {
    case 'app.store.authorize':
      await saveTokens(merchant, data || {});
      // Push every approved talent into the newly connected store.
      db.collection('talents').where('status', '==', 'approved').get()
        .then((s) => Promise.all(s.docs.map((d) => syncTalent(d.id).catch(() => {}))))
        .catch(() => {});
      break;
    case 'app.installed':
      await db.doc(`merchants/${merchant}`).set({ merchant: String(merchant), installedAt: Date.now() }, { merge: true });
      break;
    case 'app.uninstalled':
      await db.doc(`merchants/${merchant}`).set({ active: false, accessToken: '', refreshToken: '', uninstalledAt: Date.now() }, { merge: true });
      break;
    case 'order.created':
      await onOrderCreated(merchant, data || {});
      break;
    default:
      break;
  }
  res.json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* sign-in bridges                                                     */
/* ------------------------------------------------------------------ */

async function storeSso(req, res) {
  const { token, store } = req.body || {};
  if (!token || !store) throw new HttpError(400, 'token and store required');
  const m = await db.doc(`merchants/${store}`).get();
  if (!m.exists || !m.data().active) throw new HttpError(403, 'store not connected');
  const r = await fetch(`${STORE_API}/auth/user`, {
    headers: { Authorization: `Bearer ${token}`, 'Store-Identifier': String(store), Accept: 'application/json' },
  });
  const j = await r.json().catch(() => ({}));
  const c = j.data || {};
  if (!r.ok || !c.id) throw new HttpError(401, 'customer not verified');
  const uid = `s${store}_${c.id}`;
  const email = c.email || undefined;
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || '';
  try {
    await admin.auth().getUser(uid);
  } catch (e) {
    await admin.auth().createUser({ uid, displayName: name || undefined });
  }
  const customToken = await admin.auth().createCustomToken(uid, { store: String(store), customer: String(c.id) });
  res.json({ customToken, profile: { name, email: email || '', mobile: `${c.mobile_code || ''}${c.mobile || ''}` } });
}

async function embeddedSso(req, res) {
  const { token } = req.body || {};
  if (!token) throw new HttpError(400, 'token required');
  const r = await fetch(INTROSPECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'S-Source': String(process.env.SALLA_APP_ID) },
    body: JSON.stringify({ token }),
  });
  const j = await r.json().catch(() => ({}));
  const d = j.data || {};
  if (!r.ok || !d.merchant_id) throw new HttpError(401, 'session not verified');
  const m = await db.doc(`merchants/${d.merchant_id}`).get();
  if (!m.exists || !m.data().active) throw new HttpError(403, 'store not connected');
  const uid = `m${d.merchant_id}_${d.user_id}`;
  try {
    await admin.auth().getUser(uid);
  } catch (e) {
    await admin.auth().createUser({ uid });
  }
  const customToken = await admin.auth().createCustomToken(uid, { admin: true, merchant: String(d.merchant_id) });
  res.json({ customToken });
}

async function serveImage(req, res, id) {
  const snap = await db.doc(`images/${id}`).get();
  if (!snap.exists) throw new HttpError(404, 'not found');
  const m = String(snap.data().data || '').match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) throw new HttpError(404, 'not found');
  res.set('Content-Type', m[1]);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(m[2], 'base64'));
}

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

functions.http('api', async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  const path = req.path.replace(/\/+$/, '') || '/';
  try {
    let m;
    if (req.method === 'GET' && (m = path.match(/^\/img\/([A-Za-z0-9_-]+)(?:\.\w+)?$/))) return await serveImage(req, res, m[1]);
    if (req.method === 'GET' && path === '/') return res.json({ ok: true, service: 'aoss-talents-api' });
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    if (path === '/webhook') return await handleWebhook(req, res);
    if (path === '/sso/store') return await storeSso(req, res);
    if (path === '/sso/embedded') return await embeddedSso(req, res);
    if (path === '/sync') {
      const user = await firebaseUser(req);
      const uid = (req.body && req.body.uid) || user.uid;
      if (uid !== user.uid && !isAdminClaims(user)) throw new HttpError(403, 'not allowed');
      return res.json({ ok: true, salla: await syncTalent(uid) });
    }
    throw new HttpError(404, 'not found');
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.status(status).json({ ok: false, error: e.message });
  }
});
