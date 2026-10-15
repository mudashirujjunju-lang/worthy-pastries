// Worthy Pastries ordering platform — Express + SQLite (snapshotted to Postgres by persist.js)
const express = require('express');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const persist = require('./persist');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (ADMIN_PASSWORD === 'changeme') console.warn('WARNING: ADMIN_PASSWORD not set - using default "changeme". Set it before going live!');

const db = new Database(path.join(DATA_DIR, 'worthy.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS cakes(id TEXT PRIMARY KEY, cat TEXT, name TEXT, emoji TEXT, bg TEXT, descr TEXT, sizes TEXT, available INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, created_at TEXT, name TEXT, phone TEXT, phone_norm TEXT, area TEXT, date TEXT, message TEXT, notes TEXT, payment TEXT, items TEXT, subtotal INTEGER, discount INTEGER, promo TEXT, delivery_fee INTEGER, total INTEGER, status TEXT DEFAULT 'New', paid INTEGER DEFAULT 0, updated_at TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS promos(code TEXT PRIMARY KEY, percent INTEGER, first_order_only INTEGER DEFAULT 1, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, text TEXT, rating INTEGER DEFAULT 5, sample INTEGER DEFAULT 0, visible INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS uploads(name TEXT PRIMARY KEY, mime TEXT, data BLOB, created_at TEXT);
CREATE TABLE IF NOT EXISTS custom_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, name TEXT, phone TEXT, occasion TEXT, date TEXT, budget INTEGER, description TEXT, photo TEXT, status TEXT DEFAULT 'New');
`);

persist.attach(db);
// One-time migration of photos previously saved as files into the DB (so they persist too).
for (const f of fs.readdirSync(UPLOAD_DIR)) { if (!/^[\w-]+\.(png|jpg|webp)$/.test(f)) continue; const ext = f.split('.').pop(); db.prepare('INSERT OR IGNORE INTO uploads VALUES(?,?,?,?)').run(f, 'image/' + (ext === 'jpg' ? 'jpeg' : ext), fs.readFileSync(path.join(UPLOAD_DIR, f)), new Date().toISOString()); }

const SEED = require('./seed');
if (!db.prepare('SELECT COUNT(*) c FROM cakes').get().c) {
  const ins = db.prepare('INSERT INTO cakes VALUES(?,?,?,?,?,?,?,1,?)');
  SEED.cakes.forEach((c, i) => ins.run(c.id, c.cat, c.name, c.emoji, c.bg, c.desc, JSON.stringify(c.sizes.map(([label, price]) => ({ label, price }))), i));
}
const getSetting = (k, d) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? JSON.parse(r.value) : d; };
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));
const DEFAULT_PAY = "We'll send Mobile Money payment details on WhatsApp after confirming your order.";
if (getSetting('deliveryFees') == null) setSetting('deliveryFees', SEED.deliveryFees);
if (getSetting('cakeOfWeek') == null) setSetting('cakeOfWeek', SEED.cakeOfWeek);
if (getSetting('payment') == null) setSetting('payment', { instructions: DEFAULT_PAY });
if (getSetting('social') == null) setSetting('social', { instagram: '', tiktok: '', facebook: '' });
if (!db.prepare('SELECT COUNT(*) c FROM promos').get().c) db.prepare('INSERT INTO promos VALUES(?,?,?,1)').run('WORTHY10', 10, 1);
if (!db.prepare('SELECT COUNT(*) c FROM reviews').get().c) { const r = db.prepare('INSERT INTO reviews(name,text,rating,sample) VALUES(?,?,?,1)'); SEED.reviews.forEach(x => r.run(x.name, x.text, x.rating)); }

const STATUSES = ['New', 'Confirmed', 'Baking', 'Out for delivery', 'Delivered', 'Cancelled'];
const PAYMENTS = ['MTN Mobile Money', 'Airtel Money', 'Cash on delivery'];
const now = () => new Date().toISOString();
const str = (v, max, req) => { if (v == null || v === '') { if (req) throw new Error('missing'); return ''; } if (typeof v !== 'string') throw new Error('bad'); v = v.trim(); if (req && !v) throw new Error('missing'); if (v.length > max) throw new Error('too long'); return v; };
const normPhone = p => { const d = String(p || '').replace(/[^\d]/g, ''); if (/^0[0-9]{9}$/.test(d)) return '256' + d.slice(1); if (/^256[0-9]{9}$/.test(d)) return d; return null; };
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const cakeRow = r => ({ id: r.id, cat: r.cat, name: r.name, emoji: r.emoji, bg: r.bg, desc: r.descr, sizes: JSON.parse(r.sizes), available: !!r.available, sort: r.sort });
const orderRow = r => r && ({ ...r, items: JSON.parse(r.items), paid: !!r.paid });
const genNumber = () => { for (;;) { const n = 'WP-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomInt(1000, 9999); if (!db.prepare('SELECT 1 FROM orders WHERE number=?').get(n)) return n; } };
const safeUrl = u => { u = String(u || '').trim().slice(0, 200); return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : ''; };

function quote(body, forReal) {
  if (!Array.isArray(body.items) || !body.items.length) throw new Error('Cart is empty');
  if (body.items.length > 30) throw new Error('Too many items');
  const items = body.items.map(it => {
    const r = db.prepare('SELECT * FROM cakes WHERE id=?').get(String(it.id));
    if (!r || !r.available) throw new Error('Item not available: ' + it.id);
    const c = cakeRow(r); const s = c.sizes[Number(it.size)]; const qty = Number(it.qty);
    if (!s) throw new Error('Invalid size for ' + c.name);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error('Invalid quantity');
    return { id: c.id, name: c.name, emoji: c.emoji, size: s.label, unit: s.price, qty, line: s.price * qty };
  });
  const subtotal = items.reduce((a, b) => a + b.line, 0);
  const area = getSetting('deliveryFees', []).find(f => f.area === body.area);
  if (!area) throw new Error('Choose a delivery area');
  let discount = 0, promo = '', promoMsg = '';
  const code = String(body.promo || '').trim().toUpperCase();
  if (code) {
    const p = db.prepare('SELECT * FROM promos WHERE code=? AND active=1').get(code);
    const phone = normPhone(body.phone);
    if (!p) promoMsg = 'Promo code not valid';
    else if (p.first_order_only && !phone) promoMsg = 'Enter your phone number to use this first-order code';
    else if (p.first_order_only && db.prepare("SELECT 1 FROM orders WHERE phone_norm=? AND status!='Cancelled'").get(phone)) promoMsg = 'This code is for first orders only';
    else { discount = Math.round(subtotal * p.percent / 100); promo = p.code; promoMsg = `${p.percent}% off applied`; }
    if (forReal && !promo) throw new Error(promoMsg);
  }
  return { items, subtotal, discount, promo, promoMsg, deliveryFee: area.fee, total: subtotal - discount + area.fee };
}

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '6mb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'strict-origin-when-cross-origin'); next(); });
const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 15 * 60_000, max: Number(process.env.ORDER_RATE_LIMIT || 10), standardHeaders: true, legacyHeaders: false, message: { error: 'Too many submissions, please try again later or WhatsApp us.' } });
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, message: { error: 'Too many login attempts' } });
app.use('/api', apiLimiter);
// Any successful write -> snapshot DB to Postgres shortly after.
app.use((req, res, next) => { if (req.method !== 'GET' && req.method !== 'HEAD') res.on('finish', () => { if (res.statusCode < 400) persist.schedule(); }); next(); });

const publicSite = () => ({ deliveryFees: getSetting('deliveryFees'), cakeOfWeek: getSetting('cakeOfWeek'), payment: getSetting('payment'), social: getSetting('social'),
  reviews: db.prepare('SELECT id,name,text,rating,sample FROM reviews WHERE visible=1 ORDER BY id DESC').all(), whatsapp: '256772947573' });
app.get('/api/menu', (req, res) => res.json({ cats: [...new Set(db.prepare('SELECT cat FROM cakes WHERE available=1 ORDER BY sort').all().map(r => r.cat))], cakes: db.prepare('SELECT * FROM cakes WHERE available=1 ORDER BY sort').all().map(cakeRow) }));
app.get('/api/site', (req, res) => res.json(publicSite()));
app.post('/api/quote', (req, res) => { try { res.json(quote(req.body || {}, false)); } catch (e) { bad(res, e.message); } });
app.post('/api/orders', writeLimiter, (req, res) => {
  const b = req.body || {}; let v;
  try { v = { name: str(b.name, 80, true), phone: str(b.phone, 20, true), area: str(b.area, 60, true), date: str(b.date, 10, true), message: str(b.message, 60), notes: str(b.notes, 500), payment: str(b.payment, 30, true) }; }
  catch (e) { return bad(res, 'Please check your details (name, phone, area, date)'); }
  const pn = normPhone(v.phone); if (!pn) return bad(res, 'Enter a valid Ugandan phone number, e.g. 0772 123 456');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || v.date < new Date(Date.now() - 864e5).toISOString().slice(0, 10)) return bad(res, 'Choose a valid delivery date (today or later)');
  if (!PAYMENTS.includes(v.payment)) return bad(res, 'Choose a payment method');
  let q; try { q = quote(b, true); } catch (e) { return bad(res, e.message); }
  const number = genNumber();
  db.prepare(`INSERT INTO orders(number,created_at,name,phone,phone_norm,area,date,message,notes,payment,items,subtotal,discount,promo,delivery_fee,total,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(number, now(), v.name, v.phone, pn, v.area, v.date, v.message, v.notes, v.payment, JSON.stringify(q.items), q.subtotal, q.discount, q.promo, q.deliveryFee, q.total, now());
  res.status(201).json({ number, ...q, status: 'New', payment: v.payment, paymentInstructions: v.payment === 'Cash on delivery' ? '' : getSetting('payment').instructions });
});
app.post('/api/track', (req, res) => {
  const b = req.body || {}; const pn = normPhone(b.phone);
  const o = pn && db.prepare('SELECT * FROM orders WHERE number=? AND phone_norm=?').get(String(b.number || '').trim().toUpperCase(), pn);
  if (!o) return bad(res, 'No order found with that number and phone', 404);
  const x = orderRow(o);
  res.json({ number: x.number, status: x.status, paid: x.paid, created_at: x.created_at, date: x.date, area: x.area, items: x.items, subtotal: x.subtotal, discount: x.discount, delivery_fee: x.delivery_fee, total: x.total, payment: x.payment, updated_at: x.updated_at });
});
app.post('/api/custom-requests', writeLimiter, (req, res) => {
  const b = req.body || {}; let v;
  try { v = { name: str(b.name, 80, true), phone: str(b.phone, 20, true), occasion: str(b.occasion, 60), date: str(b.date, 10, true), description: str(b.description, 1000, true) }; } catch (e) { return bad(res, 'Please fill in name, phone, date and description'); }
  if (!normPhone(v.phone)) return bad(res, 'Enter a valid Ugandan phone number');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return bad(res, 'Invalid date');
  const budget = b.budget ? parseInt(b.budget, 10) : 0; if (isNaN(budget) || budget < 0 || budget > 100000000) return bad(res, 'Invalid budget');
  let photo = '';
  if (b.photo) {
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.photo));
    if (!m) return bad(res, 'Photo must be PNG, JPG or WEBP');
    const buf = Buffer.from(m[2], 'base64'); if (buf.length > 4 * 1024 * 1024) return bad(res, 'Photo too large (max 4 MB)');
    photo = crypto.randomUUID() + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
    db.prepare('INSERT INTO uploads VALUES(?,?,?,?)').run(photo, 'image/' + (m[1] === 'jpg' ? 'jpeg' : m[1]), buf, now());
  }
  const r = db.prepare('INSERT INTO custom_requests(created_at,name,phone,occasion,date,budget,description,photo) VALUES(?,?,?,?,?,?,?,?)').run(now(), v.name, v.phone, v.occasion, v.date, budget, v.description, photo);
  res.status(201).json({ id: r.lastInsertRowid, ref: 'CR-' + r.lastInsertRowid });
});

// ---------- Admin ----------
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('wp:' + ADMIN_PASSWORD).digest('hex');
if (!process.env.SESSION_SECRET) console.warn('WARNING: SESSION_SECRET not set - deriving from ADMIN_PASSWORD.');
// Tokens carry a session generation; bumping it (on password change) invalidates all older tokens.
const gen = () => getSetting('sessionGen', 0);
const mac = (exp, g) => crypto.createHmac('sha256', SECRET).update(exp + '.' + g).digest('hex');
const sign = exp => exp + '.' + gen() + '.' + mac(exp, gen());
const verify = t => { const [exp, g, sig] = String(t || '').split('.'); if (!exp || !sig || g === undefined || Date.now() > +exp || String(gen()) !== g) return false; const good = mac(exp, g); return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)); };
const h = s => crypto.createHash('sha256').update(String(s)).digest();
const hashPw = pw => { const salt = crypto.randomBytes(16).toString('hex'); return { algo: 'scrypt', salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') }; };
const checkPw = pw => {
  pw = typeof pw === 'string' ? pw : '';
  const st = getSetting('adminPasswordHash');
  if (st && st.salt && st.hash) { const a = crypto.scryptSync(pw, st.salt, 64), b = Buffer.from(st.hash, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); }
  return crypto.timingSafeEqual(h(pw), h(ADMIN_PASSWORD));
};
const isDefaultPw = () => !getSetting('adminPasswordHash') && ADMIN_PASSWORD === 'changeme';
app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (!checkPw((req.body || {}).password)) return bad(res, 'Wrong password', 401);
  res.json({ token: sign(Date.now() + 12 * 3600e3), defaultPassword: isDefaultPw() });
});
app.use('/api/admin', (req, res, next) => verify((req.get('authorization') || '').replace(/^Bearer /, '')) ? next() : bad(res, 'Unauthorized', 401));
app.get('/admin/uploads/:f', (req, res) => { if (!verify(req.query.t)) return res.sendStatus(401); const u = db.prepare('SELECT mime,data FROM uploads WHERE name=?').get(path.basename(req.params.f)); if (!u) return res.sendStatus(404); res.type(u.mime).set('Cache-Control', 'private, max-age=3600').send(u.data); });

app.post('/api/admin/password', loginLimiter, (req, res) => {
  const b = req.body || {};
  if (!checkPw(b.current)) return bad(res, 'Current password is wrong', 403);
  if (typeof b.next !== 'string' || b.next.length < 8) return bad(res, 'New password must be at least 8 characters');
  if (b.next.length > 200) return bad(res, 'New password too long');
  if (b.next !== b.confirm) return bad(res, 'New passwords do not match');
  setSetting('adminPasswordHash', hashPw(b.next));
  setSetting('sessionGen', gen() + 1);
  res.json({ ok: true, token: sign(Date.now() + 12 * 3600e3) });
});
app.get('/api/admin/orders', (req, res) => {
  const s = req.query.status; const rows = s && STATUSES.includes(s) ? db.prepare('SELECT * FROM orders WHERE status=? ORDER BY id DESC').all(s) : db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 500').all();
  const counts = Object.fromEntries(db.prepare('SELECT status,COUNT(*) c FROM orders GROUP BY status').all().map(r => [r.status, r.c]));
  res.json({ orders: rows.map(orderRow), counts, statuses: STATUSES, defaultPassword: isDefaultPw() });
});
app.patch('/api/admin/orders/:number', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE number=?').get(req.params.number); if (!o) return bad(res, 'Not found', 404);
  const b = req.body || {}; if (b.status !== undefined && !STATUSES.includes(b.status)) return bad(res, 'Invalid status');
  db.prepare('UPDATE orders SET status=?, paid=?, updated_at=? WHERE id=?').run(b.status ?? o.status, b.paid !== undefined ? (b.paid ? 1 : 0) : o.paid, now(), o.id);
  res.json(orderRow(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id)));
});
app.get('/api/admin/cakes', (req, res) => res.json(db.prepare('SELECT * FROM cakes ORDER BY sort').all().map(cakeRow)));
app.put('/api/admin/cakes/:id', (req, res) => {
  const b = req.body || {}; const id = req.params.id;
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return bad(res, 'id must be lowercase letters/numbers/dashes');
  let v; try { v = { cat: str(b.cat, 60, true), name: str(b.name, 80, true), emoji: str(b.emoji, 16) || '🎂', desc: str(b.desc, 500) }; } catch (e) { return bad(res, 'Category and name are required'); }
  const bg = /^#[0-9a-f]{6}$/i.test(b.bg) ? b.bg : '#fff1c9';
  if (!Array.isArray(b.sizes) || !b.sizes.length || b.sizes.length > 10) return bad(res, 'Add 1-10 sizes');
  const sizes = []; for (const s of b.sizes) { const label = String(s.label || '').trim().slice(0, 40), price = parseInt(s.price, 10); if (!label || !(price > 0 && price < 100000000)) return bad(res, 'Each size needs a label and a positive price'); sizes.push({ label, price }); }
  db.prepare('INSERT INTO cakes VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET cat=excluded.cat,name=excluded.name,emoji=excluded.emoji,bg=excluded.bg,descr=excluded.descr,sizes=excluded.sizes,available=excluded.available,sort=excluded.sort')
    .run(id, v.cat, v.name, v.emoji, bg, v.desc, JSON.stringify(sizes), b.available === false ? 0 : 1, Number.isInteger(+b.sort) ? +b.sort : 99);
  res.json(cakeRow(db.prepare('SELECT * FROM cakes WHERE id=?').get(id)));
});
app.delete('/api/admin/cakes/:id', (req, res) => { db.prepare('DELETE FROM cakes WHERE id=?').run(req.params.id); res.json({ ok: true }); });
app.get('/api/admin/settings', (req, res) => res.json({ deliveryFees: getSetting('deliveryFees'), cakeOfWeek: getSetting('cakeOfWeek'), payment: getSetting('payment'), social: getSetting('social') }));
app.put('/api/admin/settings', (req, res) => {
  const b = req.body || {};
  if (b.deliveryFees) { if (!Array.isArray(b.deliveryFees) || !b.deliveryFees.length) return bad(res, 'Invalid fees'); const f = b.deliveryFees.map(x => ({ area: String(x.area || '').trim().slice(0, 60), fee: parseInt(x.fee, 10) })); if (f.some(x => !x.area || !(x.fee >= 0))) return bad(res, 'Each area needs a name and fee >= 0'); setSetting('deliveryFees', f); }
  if (b.cakeOfWeek) { const c = b.cakeOfWeek; setSetting('cakeOfWeek', { enabled: !!c.enabled, badge: String(c.badge || '').slice(0, 30), title: String(c.title || '').slice(0, 80), text: String(c.text || '').slice(0, 300), cakeId: String(c.cakeId || '').slice(0, 40) }); }
  if (b.payment) setSetting('payment', { instructions: String(b.payment.instructions || '').trim().slice(0, 500) || DEFAULT_PAY });
  if (b.social) { const s = b.social; for (const k of ['instagram', 'tiktok', 'facebook']) if (s[k] && !safeUrl(s[k])) return bad(res, k + ' link must start with https://'); setSetting('social', { instagram: safeUrl(s.instagram), tiktok: safeUrl(s.tiktok), facebook: safeUrl(s.facebook) }); }
  res.json({ ok: true });
});
app.get('/api/admin/promos', (req, res) => res.json(db.prepare('SELECT * FROM promos').all()));
app.put('/api/admin/promos/:code', (req, res) => { const b = req.body || {}; const code = req.params.code.toUpperCase(); const pct = parseInt(b.percent, 10); if (!/^[A-Z0-9]{3,20}$/.test(code) || !(pct > 0 && pct <= 90)) return bad(res, 'Code 3-20 letters/numbers, percent 1-90'); db.prepare('INSERT INTO promos VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET percent=excluded.percent,first_order_only=excluded.first_order_only,active=excluded.active').run(code, pct, b.first_order_only ? 1 : 0, b.active === false ? 0 : 1); res.json({ ok: true }); });
app.delete('/api/admin/promos/:code', (req, res) => { db.prepare('DELETE FROM promos WHERE code=?').run(req.params.code.toUpperCase()); res.json({ ok: true }); });
app.get('/api/admin/reviews', (req, res) => res.json(db.prepare('SELECT * FROM reviews ORDER BY id DESC').all()));
app.post('/api/admin/reviews', (req, res) => { const b = req.body || {}; let v; try { v = { name: str(b.name, 60, true), text: str(b.text, 500, true) }; } catch (e) { return bad(res, 'Name and text required'); } const rating = Math.min(5, Math.max(1, parseInt(b.rating, 10) || 5)); const id = parseInt(b.id, 10); const args = [v.name, v.text, rating, b.sample ? 1 : 0, b.visible === false ? 0 : 1]; if (id) db.prepare('UPDATE reviews SET name=?,text=?,rating=?,sample=?,visible=? WHERE id=?').run(...args, id); else db.prepare('INSERT INTO reviews(name,text,rating,sample,visible) VALUES(?,?,?,?,?)').run(...args); res.json({ ok: true }); });
app.delete('/api/admin/reviews/:id', (req, res) => { db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id); res.json({ ok: true }); });
app.get('/api/admin/custom-requests', (req, res) => res.json(db.prepare('SELECT * FROM custom_requests ORDER BY id DESC').all()));
app.patch('/api/admin/custom-requests/:id', (req, res) => { const s = (req.body || {}).status; if (!['New', 'Quoted', 'Accepted', 'Declined', 'Done'].includes(s)) return bad(res, 'Invalid status'); db.prepare('UPDATE custom_requests SET status=? WHERE id=?').run(s, req.params.id); res.json({ ok: true }); });

app.use(['/admin', '/api/admin'], (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
// Verification files (google*.html, BingSiteAuth.xml, yandex_*.html, <indexnow-key>.txt) dropped into public/ are served by express.static below.
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/api/persistence', (req, res) => res.json({ durable: persist.enabled() }));
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/track', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => bad(res, 'Not found', 404));
app.use((err, req, res, next) => { if (err.status && err.status < 500) return bad(res, err.type === 'entity.too.large' ? 'Upload too large (max ~4 MB)' : 'Bad request', err.status); console.error(err); bad(res, 'Server error', 500); });
app.listen(PORT, () => { console.log(`Worthy Pastries running on http://localhost:${PORT}`); persist.save(); });
