# Worthy Pastries — Online Ordering Platform

Cake ordering site + admin dashboard for **Worthy Pastries** (Norah Tumuhimbise, Makindye, Kampala · WhatsApp +256 772 947 573).
Node.js + Express + SQLite (better-sqlite3). No build step.

## Features
**Customer site** (`/`): hero with *Order now* CTA and trust badges · Cake of the week banner · shop by occasion · menu loaded from the API ·
cart with live server-side quote (subtotal, promo, delivery fee by area — free in Makindye) · promo code **WORTHY10** (10% off, first order per phone) ·
payment choice (MTN MoMo / Airtel Money / Cash on delivery) with editable MoMo instructions · order saved with an order number (e.g. `WP-261015-1234`) and confirmation page ·
prefilled WhatsApp button with the order number · custom cake request form (reference photo, budget, date) · reviews (seeded samples, clearly labelled) ·
gallery placeholder · FAQ · Google Maps embed · floating WhatsApp button · social links (hidden until set in admin) · SEO meta, Open Graph, schema.org Bakery · PWA.

**Order tracking** (`/track`): order number + phone → status timeline and paid flag.

**Admin** (`/admin`, password = `ADMIN_PASSWORD`): orders list with status filters & stats, order details, status update
(New → Confirmed → Baking → Out for delivery → Delivered / Cancelled), mark paid, WhatsApp customer · custom requests (view photo, set status) ·
menu manager (cakes, categories, sizes, prices, availability, add/delete) · promo codes · reviews · settings (cake of the week, delivery fees, MoMo instructions, social links).

**Safety**: prices are always recalculated on the server (client prices ignored) · input validation (Ugandan phone formats 07…/+256…, dates, lengths, image type/size) ·
rate limits (API 120/min/IP; orders & custom requests 10 per 15 min/IP; login 10 per 15 min) · HMAC-signed admin tokens (12 h) · output escaping.

## Run locally
```bash
npm install
cp .env.example .env        # optional; or just: ADMIN_PASSWORD=secret npm start
ADMIN_PASSWORD=secret npm start
# open http://localhost:3000  and  http://localhost:3000/admin
./test-e2e.sh               # API end-to-end test (needs curl + jq); PW=secret ./test-e2e.sh
```
The DB (`data/worthy.db`) is created and seeded from `seed.js` on first start. To reset, stop the server and delete `data/`.
If `ADMIN_PASSWORD` is not set, the password is **changeme** and a warning is shown in the log and the dashboard.

## Deploy free on Render
1. Push this folder to a GitHub repo.
2. Render → **New → Blueprint** (uses `render.yaml`) or **New → Web Service**: Build `npm install`, Start `npm start`, Node 20.
3. Set env var **ADMIN_PASSWORD** to a strong password.
4. Open `https://<your-app>.onrender.com`.

⚠️ **Free tier caveats**: Render free web services *sleep after ~15 min idle* (first visit takes ~30–60 s) and have an **ephemeral filesystem** —
the SQLite DB and uploaded photos are **wiped on every redeploy/restart**. For real use, either:
- add a Render persistent disk (paid, ~$7/mo starter + disk) mounted at e.g. `/var/data` and set `DATA_DIR=/var/data`, or
- use **Railway** (add a Volume, mount at `/data`, set `DATA_DIR=/data`), or a small VPS.
Back up `worthy.db` regularly (download it from the disk, or export orders).

**Railway**: New Project → Deploy from GitHub → add Volume → set `ADMIN_PASSWORD` and `DATA_DIR` → done (it runs `npm start`).

## Payments
No real payment integration yet — the chosen method is recorded and Norah marks orders paid in admin.
Mobile Money customers see the editable text (Admin → Settings), default: *"We'll send Mobile Money payment details on WhatsApp after confirming your order."*
Add a MoMo merchant code / number there when available.
Real automated payments need merchant API accounts: **MTN MoMo Open API** (momodeveloper.mtn.com, Collections product, business KYC) and
**Airtel Money Open API** (developers.airtel.africa), or an aggregator (e.g. Flutterwave, Pesapal, DPO) — then add a payment-request call on order creation and a webhook to set `paid`.

## Customise
- Menu, prices, delivery fees, banner, reviews, promo codes, social links, payment text: all in the admin dashboard.
- Seed data for a fresh DB: `seed.js`. Design: `public/styles.css`. Customer logic: `public/app.js`. API: `server.js`.
- Replace the sample reviews and gallery emoji tiles with real ones; set an Open Graph image (`og:image` in `public/index.html`) to a real cake photo (1200×630) using an absolute URL once you have a domain.

## API (summary)
Public: `GET /api/menu`, `GET /api/site`, `POST /api/quote`, `POST /api/orders`, `POST /api/track`, `POST /api/custom-requests`.
Admin (Bearer token from `POST /api/admin/login`): `/api/admin/orders` (GET, PATCH `/:number`), `/cakes`, `/promos`, `/reviews`, `/settings`, `/custom-requests`.
