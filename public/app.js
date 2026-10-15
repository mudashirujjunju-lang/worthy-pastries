// Worthy Pastries customer site — loads menu & settings from the API, posts orders to the server.
const $ = s => document.querySelector(s);
const fmt = n => 'UGX ' + Number(n).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = s => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
let CAKES = [], SITE = {}, quoteData = null;
const cart = JSON.parse(localStorage.getItem('wp-cart2') || '{}'); // key "id|sizeIndex" -> qty
const look = k => { const [id, i] = k.split('|'); const c = CAKES.find(x => x.id === id); return c && c.sizes[i] ? { c, size: c.sizes[i].label, price: c.sizes[i].price } : null; };
const api = async (url, body) => { const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); const j = await r.json().catch(() => ({ error: 'Network error' })); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; };
const f = $('#orderForm');
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
f.date.min = today; $('#customForm').date.min = today;

async function init() {
  try { const [m, s] = await Promise.all([api('/api/menu'), api('/api/site')]); CAKES = m.cakes; SITE = s; renderMenu(m.cats); renderSite(); }
  catch (e) { $('#menuGrid').innerHTML = `<p class="error">Couldn't load the menu. Please refresh or <a href="https://wa.me/256772947573">WhatsApp us</a>.</p>`; return; }
  for (const k in cart) if (!look(k)) delete cart[k];
  render();
}
function renderMenu(cats) {
  $('#menuGrid').innerHTML = cats.map(cat => `<h3 class="cat" id="cat-${slug(cat)}">${esc(cat)}</h3>` + CAKES.filter(c => c.cat === cat).map(c => `<article class="card" id="cake-${esc(c.id)}"><div class="art" style="background:${esc(c.bg)}">${esc(c.emoji)}</div><div class="body"><h3>${esc(c.name)}</h3><p>${esc(c.desc)}</p><select id="sz-${esc(c.id)}" aria-label="Size">${c.sizes.map((s, i) => `<option value="${i}">${esc(s.label)} — ${fmt(s.price)}</option>`).join('')}</select><div class="row"><span class="price">from ${fmt(c.sizes[0].price)}</span><button class="btn" data-pick="${esc(c.id)}">Add</button></div></div></article>`).join('')).join('');
}
function renderSite() {
  $('#areaSel').innerHTML = SITE.deliveryFees.map(a => `<option value="${esc(a.area)}">${esc(a.area)} — ${a.fee ? fmt(a.fee) : 'FREE delivery'}</option>`).join('');
  const w = SITE.cakeOfWeek;
  if (w && w.enabled) { const c = CAKES.find(x => x.id === w.cakeId); $('#cotw').innerHTML = `<span class="tag">⭐ ${esc(w.badge || 'Cake of the week')}</span><h3>${esc(w.title)}</h3><p>${esc(w.text)}</p>${c ? `<button class="btn" data-pick="${esc(c.id)}">Add ${esc(c.name)} — ${fmt(c.sizes[0].price)}</button>` : ''}`; $('#cotw').hidden = false; }
  $('#reviewList').innerHTML = SITE.reviews.map(r => `<div class="review"><div class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div><p>“${esc(r.text)}”</p><b>${esc(r.name)}</b> ${r.sample ? '<span class="sample">Sample review</span>' : ''}</div>`).join('') || '<p class="center">Reviews coming soon.</p>';
  if (SITE.reviews.some(r => r.sample)) $('#reviewList').insertAdjacentHTML('afterend', '<p class="center small">Sample reviews shown for illustration — real customer reviews coming soon.</p>');
  const s = SITE.social || {}, names = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' };
  $('#social').innerHTML = Object.keys(names).filter(k => s[k]).map(k => `<a href="${esc(s[k])}" target="_blank" rel="noopener">${names[k]}</a>`).join(' · ');
  $('#social').hidden = !$('#social').innerHTML; payInfo();
}
function payInfo() { const p = f.payment.value; $('#payInfo').textContent = p === 'Cash on delivery' ? 'Pay in cash when your cake is delivered.' : (SITE.payment?.instructions || ''); }
function cartItems() { return Object.keys(cart).map(k => { const [id, size] = k.split('|'); return { id, size: +size, qty: cart[k] }; }); }
let qTimer;
function render() {
  localStorage.setItem('wp-cart2', JSON.stringify(cart)); let t = 0, n = 0;
  const keys = Object.keys(cart);
  $('#cartList').innerHTML = keys.length ? keys.map(k => { const { c, size, price } = look(k); t += price * cart[k]; n += cart[k]; return `<li><span>${esc(c.emoji)} ${esc(c.name)} (${esc(size)})<br><small>${fmt(price * cart[k])}</small></span><span class="qty"><button data-dec="${esc(k)}" aria-label="less">−</button> ${cart[k]} <button data-add="${esc(k)}" aria-label="more">+</button></span></li>`; }).join('') : '<li>Your cart is empty — add a cake above 🎂</li>';
  $('#cartCount').textContent = n;
  $('#totals').innerHTML = `<div><span>Subtotal</span><b>${fmt(t)}</b></div>`;
  clearTimeout(qTimer); qTimer = setTimeout(refreshQuote, 250);
}
async function refreshQuote() {
  if (!Object.keys(cart).length) { quoteData = null; return; }
  try {
    const q = await api('/api/quote', { items: cartItems(), area: f.area.value, promo: f.promo.value, phone: f.phone.value }); quoteData = q;
    $('#totals').innerHTML = `<div><span>Subtotal</span><b>${fmt(q.subtotal)}</b></div>${q.discount ? `<div class="ok"><span>Discount (${esc(q.promo)})</span><b>− ${fmt(q.discount)}</b></div>` : ''}<div><span>Delivery to ${esc(f.area.value)}</span><b>${q.deliveryFee ? fmt(q.deliveryFee) : 'FREE'}</b></div><div class="grand"><span>Total</span><b>${fmt(q.total)}</b></div>`;
    $('#promoMsg').textContent = q.promoMsg || ''; $('#promoMsg').className = q.promo ? 'ok' : (q.promoMsg ? 'error' : '');
  } catch (e) { $('#promoMsg').textContent = ''; }
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-pick],[data-add],[data-dec],[data-occ]'); if (!t) return;
  if (t.dataset.occ) { $('#customForm').occasion.value = t.dataset.occ; return; }
  const p = t.dataset.pick, a = p ? p + '|' + ($('#sz-' + p)?.value || 0) : t.dataset.add, d = t.dataset.dec;
  if (a) { cart[a] = Math.min(20, (cart[a] || 0) + 1); render(); $('#formError').hidden = true; if (p) { t.textContent = 'Added ✓'; setTimeout(() => t.textContent = p && t.closest('.cotw') ? t.textContent : 'Add', 1200); } }
  if (d) { cart[d]--; if (cart[d] <= 0) delete cart[d]; render(); }
});
f.area.addEventListener('change', refreshQuote); f.addEventListener('change', e => { if (e.target.name === 'payment') payInfo(); });
$('#applyPromo').onclick = refreshQuote; f.phone.addEventListener('blur', () => f.promo.value && refreshQuote());
const showErr = (el, msg) => { el.textContent = msg; el.hidden = false; };
f.addEventListener('submit', async e => {
  e.preventDefault(); const err = $('#formError'); err.hidden = true;
  if (!Object.keys(cart).length) { showErr(err, 'Please add at least one cake to your cart.'); $('#menu').scrollIntoView(); return; }
  const v = Object.fromEntries(new FormData(f));
  if (!v.name.trim() || !v.phone.trim() || !v.date) return showErr(err, 'Please fill in your name, phone and delivery date.');
  const btn = $('#submitBtn'); btn.disabled = true; btn.textContent = 'Placing order…';
  try {
    const o = await api('/api/orders', { ...v, items: cartItems() });
    const lines = o.items.map(i => `• ${i.qty} x ${i.name}, ${i.size} (${fmt(i.line)})`).join('\n');
    const msg = `🎂 *Worthy Pastries order ${o.number}*\n\n${lines}\nSubtotal: ${fmt(o.subtotal)}${o.discount ? `\nDiscount (${o.promo}): -${fmt(o.discount)}` : ''}\nDelivery: ${o.deliveryFee ? fmt(o.deliveryFee) : 'FREE'}\n*Total: ${fmt(o.total)}*\n\nName: ${v.name}\nPhone: ${v.phone}\nArea: ${v.area}\nDate: ${v.date}\nCake message: ${v.message || '-'}\nNotes: ${v.notes || '-'}\nPayment: ${o.payment}`;
    const url = `https://wa.me/${SITE.whatsapp || '256772947573'}?text=${encodeURIComponent(msg)}`;
    $('#confirm').innerHTML = `<div class="big">✅</div><h3>Thank you, ${esc(v.name.split(' ')[0])}! Your order is received.</h3><p>Your order number:</p><div class="ordno" id="orderNumber">${esc(o.number)}</div><p class="small">Save this number with your phone to <a href="/track?n=${encodeURIComponent(o.number)}">track your order</a>.</p>
      <div class="summary">${o.items.map(i => `<div><span>${i.qty} × ${esc(i.name)} (${esc(i.size)})</span><b>${fmt(i.line)}</b></div>`).join('')}${o.discount ? `<div class="ok"><span>Discount ${esc(o.promo)}</span><b>− ${fmt(o.discount)}</b></div>` : ''}<div><span>Delivery</span><b>${o.deliveryFee ? fmt(o.deliveryFee) : 'FREE'}</b></div><div><span><b>Total</b></span><b>${fmt(o.total)}</b></div><div><span>Payment</span><span>${esc(o.payment)}</span></div></div>
      ${o.paymentInstructions ? `<p class="payinfo">📱 ${esc(o.paymentInstructions)}</p>` : ''}
      <p>Norah will confirm your order shortly. For a faster reply, send it on WhatsApp too:</p>
      <a class="btn" href="${url}" target="_blank" rel="noopener">💬 Send on WhatsApp</a> <a class="btn ghost" href="/track?n=${encodeURIComponent(o.number)}">Track order</a> <button id="newOrder" class="btn ghost" type="button">New order</button>`;
    localStorage.setItem('wp-last-order', JSON.stringify({ number: o.number, phone: v.phone }));
    for (const k in cart) delete cart[k]; render(); f.reset(); f.hidden = true; $('#confirm').hidden = false; $('#confirm').scrollIntoView();
    $('#newOrder').onclick = () => { f.hidden = false; $('#confirm').hidden = true; payInfo(); };
  } catch (ex) { showErr(err, ex.message); } finally { btn.disabled = false; btn.textContent = 'Place order'; }
});
const cf = $('#customForm');
cf.addEventListener('submit', async e => {
  e.preventDefault(); const err = $('#customError'); err.hidden = true;
  const v = Object.fromEntries(new FormData(cf)); const file = cf.photo.files[0]; delete v.photo;
  if (!v.name.trim() || !v.phone.trim() || !v.date || !v.description.trim()) return showErr(err, 'Please fill in name, phone, date and description.');
  if (file) { if (file.size > 4 * 1024 * 1024) return showErr(err, 'Photo too large (max 4 MB).'); v.photo = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); }); }
  try { const r = await api('/api/custom-requests', v); cf.hidden = true; $('#customDone').innerHTML = `<div class="big">🎨</div><h3>Request sent!</h3><p>Reference: <b>${esc(r.ref)}</b>. Norah will contact you on ${esc(v.phone)} with a quote.</p><a class="btn" target="_blank" rel="noopener" href="https://wa.me/256772947573?text=${encodeURIComponent('Hello! I sent custom cake request ' + r.ref)}">💬 Follow up on WhatsApp</a>`; $('#customDone').hidden = false; }
  catch (ex) { showErr(err, ex.message); }
});
$('#yr').textContent = new Date().getFullYear();
init();
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
