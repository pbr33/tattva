# Shri Om Tattva

Temple-consecrated sacred articles ecommerce site — malas, rudraksha, yantras,
bracelets and puja essentials from Shri Chakra Sahitha Rudra Mahakali – Shri
Sarpaskanda Subrahmanya Mandir.

**Live checkout:** Razorpay (UPI / cards / netbanking / wallets) with a
WhatsApp-order fallback. Includes a Jyotish (rashi-based) product
recommendation engine.

## Structure

The storefront itself is a **single-file site** — `index.html` contains all
markup, CSS and JavaScript, with product photos embedded inline as base64 so
it needs no build step and no asset pipeline. That's intentional for
zero-friction hosting, but see "Suggested next steps" below if you want to
break it apart as the project grows.

Checkout and the admin panel do need a small backend — a handful of Netlify
Functions, since Razorpay order creation/signature verification and any
persistent order storage can't safely live in client-side JS alone.

```
.
├── index.html                    # the storefront (all markup/CSS/JS)
├── admin.html                    # admin dashboard (orders + visitor activity)
├── om-logo.png                   # site logo (favicon, header, footer)
├── package.json                  # one dependency: @netlify/blobs
├── netlify.toml                  # Netlify build/publish/functions config
├── robots.txt / sitemap.xml / manifest.webmanifest
└── netlify/functions/
    ├── create-order.js           # Razorpay order creation (server-computed amount)
    ├── verify-payment.js         # Razorpay signature verification
    ├── track-event.js            # visitor activity logging (public)
    ├── log-order.js              # records WhatsApp-path orders (public)
    ├── admin-login.js / admin-logout.js
    ├── admin-orders.js / admin-sessions.js / admin-update-order.js
    └── lib/
        ├── pricing.js            # authoritative price table (mirrors PRODUCTS)
        ├── blobs.js               # Netlify Blobs store helpers
        └── auth.js                # admin session cookie sign/verify
```

## Local development

For just browsing the storefront's markup/styling, opening `index.html`
directly or serving it with `python3 -m http.server 8000` is fine.

To actually test checkout or the admin panel, the Netlify Functions need to
run too — use the Netlify CLI, which serves the static site *and* the
functions together:

```bash
npm install                 # installs @netlify/blobs
npm install -g netlify-cli  # if you don't already have it
netlify link                # first time only — connects this folder to your Netlify site
netlify dev                 # serves the site + functions at http://localhost:8888
```

You'll need a `.env` file (gitignored, never commit it) with:

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
ADMIN_PASSWORD=choose-a-strong-password
ADMIN_SESSION_SECRET=a-long-random-string
```

The same four values need to be set on the live Netlify site too —
`netlify env:set NAME value`, or via the Netlify dashboard (Site
configuration → Environment variables). Netlify Blobs (used for order/activity
storage) is meant to auto-configure inside deployed Functions, but didn't in
this project's setup — `netlify/functions/lib/blobs.js` falls back to
explicit credentials if `NETLIFY_BLOBS_SITE_ID` / `NETLIFY_BLOBS_TOKEN` are
set. If your own deploy has automatic injection working, those two extra
vars aren't needed.

## Before going live — required edits

Open `index.html`, find the `CONFIG` object near the top of the `<script>`
block (search for `RAZORPAY_KEY`), and set every `PASTE_..._HERE` value:

```js
const CONFIG = {
  RAZORPAY_KEY: "rzp_live_XXXXXXXX",     // from razorpay.com dashboard
  WHATSAPP: "91XXXXXXXXXX",               // digits only, country code + number
  PHONE_DISPLAY: "+91 XXXXX XXXXX",       // shown in the footer
  EMAIL: "orders@yourdomain.com",         // a real, monitored inbox
  ADDRESS: "Full registered address",     // shown in footer + JSON-LD
  ...
};
```

`WHATSAPP` is now the single source of truth for every WhatsApp/phone link on
the site (footer, floating button, Jyotish section) — the footer and
floating button used to have the number hardcoded separately, which meant
editing `CONFIG` alone didn't actually update them. That's fixed: they're now
populated from `CONFIG` at page load via `applyContactConfig()`.

Everything else (products, prices, testimonials, FAQ) is also editable in
that same `<script>` block — search for `const PRODUCTS = [` etc.

**Also required for Razorpay's live-mode activation:** review the four policy
sections near the bottom of the page (`id="policies"` — Privacy, Terms,
Refund & Cancellation, Shipping). They're a starting draft, not legal advice —
confirm the actual return window, who pays return shipping, and your GSTIN
(if registered) before relying on them. The `TESTIMONIALS` section is
currently sample/illustrative content (labelled as such on the page) —
replace with real devotee reviews when available.

`CONFIG.RAZORPAY_KEY` currently holds a **test** key (`rzp_test_...`) — swap
it for your live key (and set the matching live `RAZORPAY_KEY_SECRET` env
var) once you're ready to accept real payments.

## Admin panel

Visit `/admin` on the deployed site (redirects to `admin.html`) and sign in
with `ADMIN_PASSWORD`. It shows:

- **Orders** — every order, whether paid via Razorpay or placed via the
  WhatsApp fallback, with customer/items/amount and a status dropdown
  (Processing → Shipped → Delivered, or Cancelled / Return / Replacement /
  Refunded) plus a note field — each change is timestamped and kept in that
  order's history.
- **Visitor activity** — a first-party funnel: session start, products
  viewed, products added to basket, and whether that session converted to an
  order. No third-party analytics or ad tracking involved (see the Privacy
  Policy section on the storefront).

The page itself is excluded from search indexing (`robots.txt` +
`X-Robots-Tag` header) and every admin API call requires a valid signed
session cookie issued by `/api/admin-login` — there's no public entry point
into order data.

## Deploy

### Netlify (already set up)
This project is deployed via the Netlify CLI (`netlify deploy --prod`) to a
site connected to your Netlify account — see Local development above for the
one-time `netlify link`. To get continuous deploy-on-push instead, connect
the GitHub repo in the Netlify dashboard under Site configuration → Build &
deploy → Link repository.

### Static-only hosts (GitHub Pages, Netlify Drop, etc.)
These will serve `index.html` fine for browsing, but **checkout and the
admin panel won't work** — both depend on the Netlify Functions in
`netlify/functions/`, which only run on Netlify (or an equivalent serverless
platform you'd have to port them to).

## Suggested next steps for Claude Code

The single-file approach works well for a simple storefront but will get
harder to maintain as you add features. Natural next steps, roughly in order
of value:

1. **Split the file** — pull the `<style>` into `styles.css` and the
   `<script>` into `app.js`. Move product photos to `/images` and reference
   them by path instead of base64 (cuts the file from ~1.4MB to a few KB of
   markup + lazily-loaded images).
2. **Move `PRODUCTS` to a JSON/CMS** — right now the catalogue is a
   hardcoded JS array (duplicated, id+price only, in
   `netlify/functions/lib/pricing.js` for server-side amount verification —
   keep the two in sync manually until this is centralized). A
   `products.json` (or a real backend / headless CMS) would make it editable
   without touching code and remove the duplication.
3. ~~Real order backend~~ — done: `netlify/functions/create-order.js` and
   `verify-payment.js` handle server-side amount calculation and signature
   verification; orders and visitor activity persist to Netlify Blobs and are
   visible in `/admin`.
4. **Real testimonials** — the three testimonials in the Testimonials
   section are placeholders (there's a `NOTE FOR THE MANDIR` comment above
   them in the code) — replace with real devotee reviews before launch.
5. **Analytics** — first-party funnel tracking (views/cart/conversion) now
   exists in `/admin`; a full analytics tool (Plausible/GA4) would still add
   things like traffic sources and device/geo breakdowns if you want them.
6. **Customer-facing order tracking / return requests** — returns and
   cancellations are currently admin-managed only (customer messages via
   WhatsApp, admin updates status in `/admin`). A self-service "track my
   order" page (Order ID + phone lookup) would reduce manual back-and-forth
   as order volume grows.
