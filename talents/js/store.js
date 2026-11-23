// Data layer: Firebase (Auth + Firestore) when configured, otherwise a
// localStorage demo so the site works before the backend is connected.
import { CONFIG } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.5/';

export const CATEGORIES = [
  { id: 'model', ar: 'مودل', en: 'Model' },
  { id: 'makeup', ar: 'ميكب آرتست', en: 'Makeup Artist' },
  { id: 'hair', ar: 'هير آرتست', en: 'Hair Artist' },
  { id: 'crew', ar: 'كوادر', en: 'Crew' },
];

export const CREW_ROLES = ['قهوجي', 'قهوجية', 'مضيف', 'مضيفة', 'منظم فعاليات', 'مصور', 'مصورة', 'مقدم/ة', 'أمن وتنظيم', 'مساعد إنتاج', 'أخرى'];

export const CITIES = ['الرياض', 'جدة', 'مكة', 'المدينة', 'الدمام', 'الخبر', 'الظهران', 'الأحساء', 'القصيم', 'أبها', 'خميس مشيط', 'تبوك', 'حائل', 'الطائف', 'جازان', 'نجران', 'الجبيل', 'ينبع', 'العلا'];

export const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const UNITS = { hour: 'ساعة', session: 'جلسة', day: 'يوم', event: 'مناسبة' };

export const MAX_GALLERY = 20;

export function emptyTalent(uid, email) {
  return {
    uid,
    email: email || '',
    slug: '',
    status: 'pending',
    name: '',
    category: 'model',
    crewRole: '',
    headline: '',
    bio: '',
    avatar: '',
    cover: '',
    accent: '#0a0a0a',
    gender: '',
    cities: [],
    languages: ['العربية'],
    attributes: { height: '', size: '', hairColor: '', eyeColor: '', experience: '', specialties: '' },
    social: { instagram: '', tiktok: '', snapchat: '', whatsapp: '' },
    services: [],
    packages: [],
    availability: { days: [0, 1, 2, 3, 4, 6], from: '10:00', to: '22:00', blocked: [] },
    travelFee: 0,
    deposit: 30,
    gallery: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/* ---------------- image compression ---------------- */

export async function compressImage(file, maxSide = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file);
  let { width: w, height: h } = bmp;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  let q = quality;
  let data = canvas.toDataURL('image/webp', q);
  // Firestore documents are capped at 1 MiB; keep images well under it.
  while (data.length > 700000 && q > 0.4) {
    q -= 0.1;
    data = canvas.toDataURL('image/webp', q);
  }
  if (data.length > 700000) return compressImage(file, Math.round(maxSide * 0.75), 0.75);
  return { data, w, h };
}

/* ---------------- demo backend (localStorage) ---------------- */

const LS = 'aoss_talents_demo_v1';

function demoDb() {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return seedDemo();
}
function demoSave(db) {
  try {
    localStorage.setItem(LS, JSON.stringify(db));
  } catch (e) {
    alert('مساحة المتصفح ممتلئة في وضع التجربة — احذف بعض الصور.');
  }
}

function svgCover(a, b, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="900" cy="250" r="260" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/><circle cx="900" cy="250" r="380" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="2"/><text x="80" y="720" font-family="Arial" font-size="64" fill="rgba(255,255,255,.75)">${label}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function seedDemo() {
  const mk = (id, name, category, headline, cities, a, b, services, packages, extra = {}) => ({
    ...emptyTalent(id, ''),
    slug: id,
    status: 'approved',
    name,
    category,
    headline,
    bio: 'ملف تجريبي لعرض شكل الصفحة. سجّل ملفك الحقيقي من «انضم ككادر».',
    cities,
    avatar: svgCover(b, a, ''),
    cover: svgCover(a, b, name),
    gallery: [1, 2, 3, 4, 5, 6].map((n) => svgCover(n % 2 ? a : b, n % 2 ? b : a, '0' + n)),
    services,
    packages,
    ...extra,
  });
  const db = {
    users: {},
    images: {},
    bookings: [],
    talents: {
      'demo-sara': mk('demo-sara', 'سارة — مودل', 'model', 'مودل إعلانات وتصوير منتجات', ['الرياض', 'جدة'], '#1b1b1b', '#6d5a4b',
        [
          { id: 's1', name: 'تصوير إعلاني', unit: 'hour', price: 450, minHours: 2, notes: 'يشمل تغيير 3 إطلالات' },
          { id: 's2', name: 'تصوير منتجات', unit: 'hour', price: 350, minHours: 2, notes: '' },
        ],
        [
          { id: 'p1', name: 'نصف يوم', hours: 4, price: 1500, includes: ['4 ساعات تصوير', '5 إطلالات'], badge: 'الأكثر طلبًا', sallaUrl: '' },
          { id: 'p2', name: 'يوم كامل', hours: 8, price: 2700, includes: ['8 ساعات', 'إطلالات غير محدودة'], badge: '', sallaUrl: '' },
        ],
        { attributes: { height: '172', size: 'S', hairColor: 'بني', eyeColor: 'عسلي', experience: '4', specialties: 'إعلانات، أزياء' } }),
      'demo-noura': mk('demo-noura', 'نورة — ميكب آرتست', 'makeup', 'مكياج عرائس وتصوير سينمائي', ['الرياض'], '#2a1f2b', '#a0707a',
        [
          { id: 's1', name: 'مكياج تصوير', unit: 'session', price: 600, minHours: 1, notes: '' },
          { id: 's2', name: 'مكياج عروس', unit: 'session', price: 2500, minHours: 1, notes: 'يشمل التجربة' },
        ],
        [{ id: 'p1', name: 'باقة الإنتاج', hours: 6, price: 2200, includes: ['تواجد في موقع التصوير', 'تعديلات مستمرة'], badge: '', sallaUrl: '' }]),
      'demo-hind': mk('demo-hind', 'هند — هير آرتست', 'hair', 'تسريحات تصوير ومناسبات', ['جدة', 'مكة'], '#14202a', '#5b7d8c',
        [{ id: 's1', name: 'تسريحة تصوير', unit: 'session', price: 400, minHours: 1, notes: '' }], []),
      'demo-abdullah': mk('demo-abdullah', 'عبدالله — قهوجي', 'crew', 'ضيافة وقهوة سعودية للفعاليات', ['الرياض', 'القصيم'], '#1e1a12', '#8c7444',
        [{ id: 's1', name: 'ضيافة قهوة وتمر', unit: 'hour', price: 150, minHours: 3, notes: 'شامل الدلال والفناجين' }],
        [{ id: 'p1', name: 'مناسبة مسائية', hours: 5, price: 650, includes: ['قهوجي واحد', 'تجهيز ركن الضيافة'], badge: '', sallaUrl: '' }],
        { crewRole: 'قهوجي' }),
    },
  };
  demoSave(db);
  return db;
}

const listeners = new Set();
let current = null;

function demoBackend() {
  current = JSON.parse(sessionStorage.getItem('aoss_demo_user') || 'null');
  const emit = () => listeners.forEach((fn) => fn(current));
  return {
    mode: 'demo',
    onAuth(fn) {
      listeners.add(fn);
      setTimeout(() => fn(current), 0);
      return () => listeners.delete(fn);
    },
    async signUp(email, password) {
      const db = demoDb();
      if (db.users[email]) throw new Error('هذا البريد مسجّل مسبقًا');
      db.users[email] = { password, uid: uid() };
      demoSave(db);
      current = { uid: db.users[email].uid, email };
      sessionStorage.setItem('aoss_demo_user', JSON.stringify(current));
      emit();
      return current;
    },
    async signIn(email, password) {
      const db = demoDb();
      const u = db.users[email];
      if (!u || u.password !== password) throw new Error('البريد أو كلمة المرور غير صحيحة');
      current = { uid: u.uid, email };
      sessionStorage.setItem('aoss_demo_user', JSON.stringify(current));
      emit();
      return current;
    },
    async resetPassword() {
      throw new Error('غير متاح في وضع التجربة');
    },
    async signOut() {
      current = null;
      sessionStorage.removeItem('aoss_demo_user');
      emit();
    },
    user: () => current,
    async getTalent(id) {
      return demoDb().talents[id] || null;
    },
    async getTalentBySlug(slug) {
      const t = Object.values(demoDb().talents).find((x) => x.slug === slug);
      return t || null;
    },
    async listTalents({ all = false } = {}) {
      return Object.values(demoDb().talents).filter((t) => all || t.status === 'approved');
    },
    async saveTalent(t) {
      const db = demoDb();
      const prev = db.talents[t.uid];
      if (prev && prev.status !== t.status && !isAdmin()) t.status = prev.status;
      t.updatedAt = Date.now();
      db.talents[t.uid] = t;
      demoSave(db);
      return t;
    },
    async setStatus(id, status) {
      const db = demoDb();
      if (db.talents[id]) db.talents[id].status = status;
      demoSave(db);
    },
    async slugTaken(slug, owner) {
      return Object.values(demoDb().talents).some((t) => t.slug === slug && t.uid !== owner);
    },
    async uploadImage(file) {
      const img = await compressImage(file, 1400, 0.75);
      return img.data;
    },
    async deleteImage() {},
    async createBooking(b) {
      const db = demoDb();
      const { contact, booking } = splitContact(b);
      const rec = { ...booking, id: uid(), status: 'new', createdAt: Date.now() };
      db.bookings.push(rec);
      (db.contacts = db.contacts || {})[rec.id] = contact;
      demoSave(db);
      return rec;
    },
    async getContact(id) {
      return (demoDb().contacts || {})[id] || null;
    },
    async listBookings(talentId) {
      return demoDb().bookings.filter((b) => !talentId || b.talentId === talentId).sort((a, b) => b.createdAt - a.createdAt);
    },
    async updateBooking(id, patch) {
      const db = demoDb();
      const b = db.bookings.find((x) => x.id === id);
      if (b) Object.assign(b, patch);
      demoSave(db);
    },
  };
}

/* ---------------- Firebase backend ---------------- */

async function firebaseBackend(cfg) {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(FB + 'firebase-app.js'),
    import(FB + 'firebase-auth.js'),
    import(FB + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(cfg);
  const a = auth.getAuth(app);
  const db = fs.getFirestore(app);
  let resolved = false;
  a.onAuthStateChanged((u) => {
    resolved = true;
    current = u ? { uid: u.uid, email: u.email } : null;
    listeners.forEach((fn) => fn(current));
  });
  const imgUrl = (id) => 'fs-img:' + id;
  return {
    mode: 'firebase',
    onAuth(fn) {
      listeners.add(fn);
      if (resolved) setTimeout(() => fn(current), 0);
      return () => listeners.delete(fn);
    },
    async signUp(email, password) {
      const r = await auth.createUserWithEmailAndPassword(a, email, password);
      auth.sendEmailVerification(r.user).catch(() => {});
      return { uid: r.user.uid, email };
    },
    async signIn(email, password) {
      const r = await auth.signInWithEmailAndPassword(a, email, password);
      return { uid: r.user.uid, email };
    },
    async resetPassword(email) {
      await auth.sendPasswordResetEmail(a, email);
    },
    async signOut() {
      await auth.signOut(a);
    },
    user: () => current,
    async getTalent(id) {
      try {
        const s = await fs.getDoc(fs.doc(db, 'talents', id));
        return s.exists() ? s.data() : null;
      } catch (e) {
        return null;
      }
    },
    async getTalentBySlug(slug) {
      const q = fs.query(fs.collection(db, 'talents'), fs.where('slug', '==', slug), fs.where('status', '==', 'approved'), fs.limit(1));
      const s = await fs.getDocs(q);
      return s.empty ? null : s.docs[0].data();
    },
    async listTalents({ all = false } = {}) {
      const base = fs.collection(db, 'talents');
      const q = all ? fs.query(base) : fs.query(base, fs.where('status', '==', 'approved'));
      const s = await fs.getDocs(q);
      return s.docs.map((d) => d.data());
    },
    async saveTalent(t) {
      t.updatedAt = Date.now();
      const clean = JSON.parse(JSON.stringify(t));
      if (!isAdmin()) delete clean.status; // status is set by admins only (rules enforce it too)
      const ref = fs.doc(db, 'talents', t.uid);
      const exists = (await fs.getDoc(ref)).exists();
      if (!exists) clean.status = 'pending';
      await fs.setDoc(ref, clean, { merge: true });
      return t;
    },
    async setStatus(id, status) {
      await fs.updateDoc(fs.doc(db, 'talents', id), { status });
    },
    async slugTaken(slug, owner) {
      const s = await fs.getDoc(fs.doc(db, 'slugs', slug));
      return s.exists() && s.data().owner !== owner;
    },
    async claimSlug(slug, owner, old) {
      await fs.setDoc(fs.doc(db, 'slugs', slug), { owner });
      if (old && old !== slug) await fs.deleteDoc(fs.doc(db, 'slugs', old)).catch(() => {});
    },
    async uploadImage(file) {
      const img = await compressImage(file);
      const id = uid();
      await fs.setDoc(fs.doc(db, 'images', id), { owner: current.uid, data: img.data, w: img.w, h: img.h, createdAt: Date.now() });
      return imgUrl(id);
    },
    async deleteImage(ref) {
      if (String(ref).startsWith('fs-img:')) await fs.deleteDoc(fs.doc(db, 'images', ref.slice(7))).catch(() => {});
    },
    async resolveImage(ref) {
      const s = await fs.getDoc(fs.doc(db, 'images', ref.slice(7)));
      return s.exists() ? s.data().data : '';
    },
    async createBooking(b) {
      const ref = fs.doc(fs.collection(db, 'bookings'));
      const { contact, booking } = splitContact(b);
      const rec = { ...booking, id: ref.id, status: 'new', createdAt: Date.now() };
      await fs.setDoc(ref, rec);
      // Customer phone lives in an admin-only collection.
      await fs.setDoc(fs.doc(db, 'contacts', ref.id), { ...contact, talentId: rec.talentId, createdAt: rec.createdAt });
      return rec;
    },
    async getContact(id) {
      const s = await fs.getDoc(fs.doc(db, 'contacts', id));
      return s.exists() ? s.data() : null;
    },
    async listBookings(talentId) {
      const base = fs.collection(db, 'bookings');
      const q = talentId ? fs.query(base, fs.where('talentId', '==', talentId)) : fs.query(base);
      const s = await fs.getDocs(q);
      return s.docs.map((d) => d.data()).sort((x, y) => y.createdAt - x.createdAt);
    },
    async updateBooking(id, patch) {
      await fs.updateDoc(fs.doc(db, 'bookings', id), patch);
    },
  };
}

function splitContact(b) {
  const customer = b.customer || {};
  return {
    contact: { name: customer.name || '', phone: customer.phone || '' },
    booking: { ...b, customer: { name: customer.name || '' } },
  };
}

export function isAdmin() {
  return !!(current && CONFIG.admins.includes(String(current.email || '').toLowerCase()));
}

let backendPromise = null;
export function backend() {
  if (!backendPromise) backendPromise = CONFIG.firebase ? firebaseBackend(CONFIG.firebase) : Promise.resolve(demoBackend());
  return backendPromise;
}

/* Resolve stored image refs (Firestore-backed images) to displayable URLs. */
const imgCache = new Map();
export async function imageSrc(ref) {
  if (!ref) return '';
  if (!String(ref).startsWith('fs-img:')) return ref;
  if (imgCache.has(ref)) return imgCache.get(ref);
  const p = backend().then((b) => b.resolveImage(ref));
  imgCache.set(ref, p);
  return p;
}

/* Fill every <img data-src="ref"> under root. */
export function hydrateImages(root = document) {
  root.querySelectorAll('img[data-ref]').forEach(async (img) => {
    const ref = img.getAttribute('data-ref');
    img.removeAttribute('data-ref');
    const src = await imageSrc(ref);
    if (src) img.src = src;
  });
  root.querySelectorAll('[data-bg-ref]').forEach(async (el) => {
    const ref = el.getAttribute('data-bg-ref');
    el.removeAttribute('data-bg-ref');
    const src = await imageSrc(ref);
    if (src) el.style.backgroundImage = `url("${src}")`;
  });
}

export function categoryLabel(t) {
  if (t.category === 'crew' && t.crewRole) return t.crewRole;
  const c = CATEGORIES.find((x) => x.id === t.category);
  return c ? c.ar : '';
}

export function minPrice(t) {
  const prices = [...(t.services || []).map((s) => +s.price || 0), ...(t.packages || []).map((p) => +p.price || 0)].filter((n) => n > 0);
  return prices.length ? Math.min(...prices) : 0;
}
