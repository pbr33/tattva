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
├── package.json                  # @netlify/blobs, @anthropic-ai/sdk
├── netlify.toml                  # Netlify build/publish/functions config
├── robots.txt / sitemap.xml / manifest.webmanifest
└── netlify/functions/
    ├── create-order.js           # Razorpay order creation (server-computed amount)
    ├── verify-payment.js         # Razorpay signature verification
    ├── track-event.js            # visitor activity logging (public)
    ├── log-order.js              # records WhatsApp-path orders (public)
    ├── chat.js                   # AI support chatbot (public)
    ├── validate-coupon.js        # live coupon validation for checkout (public)
    ├── auth-verify.js / auth-logout.js / auth-me.js   # customer login (public)
    ├── my-orders.js               # a signed-in customer's own orders (public)
    ├── admin-login.js / admin-logout.js
    ├── admin-orders.js / admin-sessions.js / admin-support.js / admin-customers.js
    ├── admin-update-order.js / admin-update-support.js / admin-create-shipment.js
    ├── admin-coupons.js / admin-save-coupon.js
    ├── admin-financial-settings.js / admin-save-financial-settings.js
    └── lib/
        ├── pricing.js            # authoritative price table (mirrors PRODUCTS)
        ├── coupons.js             # coupon evaluation, shared by validate-coupon.js and order creation
        ├── knowledge.js           # chatbot grounding (mirrors PRODUCTS/FAQS/policies)
        ├── shiprocket.js          # Shiprocket auth + order creation
        ├── validate.js            # input validation (oid/session_id format, customer field caps)
        ├── blobs.js               # Netlify Blobs store helpers
        ├── auth.js                # admin AND customer session cookie sign/verify
        └── firebase-admin.js      # verifies Firebase phone-auth ID tokens server-side
```

## Local development

For just browsing the storefront's markup/styling, opening `index.html`
directly or serving it with `python3 -m http.server 8000` is fine.

To actually test checkout or the admin panel, the Netlify Functions need to
run too — use the Netlify CLI, which serves the static site *and* the
functions together:

```bash
npm install                 # installs @netlify/blobs, @anthropic-ai/sdk
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
ANTHROPIC_API_KEY=sk-ant-...          # console.anthropic.com → Settings → API Keys
SHIPROCKET_EMAIL=...                  # a dedicated API user, not your main login — see below
SHIPROCKET_PASSWORD=...
SHIPROCKET_PICKUP_LOCATION=...        # exact pickup-address nickname from your Shiprocket dashboard
CUSTOMER_SESSION_SECRET=a-long-random-string    # different from ADMIN_SESSION_SECRET — customer login cookie
FIREBASE_SERVICE_ACCOUNT=...          # Firebase project → Service accounts → Generate new private key (JSON, or base64 of it) — see "Customer accounts" below
```

The same values need to be set on the live Netlify site too —
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
  order's history. Also: search/filter by order ID, name, phone or status;
  courier + tracking number fields; a one-click "Notify customer" WhatsApp
  button per order; a refund-amount field on `refunded`; and a CSV export.
- **Overview** — order counts by status, top products by quantity sold, and
  the visitor funnel (sessions → added to basket → converted).
- **Visitor activity** — a first-party funnel: session start, products
  viewed, products added to basket, and whether that session converted to an
  order. No third-party analytics or ad tracking involved (see the Privacy
  Policy section on the storefront).
- **Support conversations** — every AI chatbot conversation (see below),
  with an escalated/open/closed status and the full transcript.

The page itself is excluded from search indexing (`robots.txt` +
`X-Robots-Tag` header) and every admin API call requires a valid signed
session cookie issued by `/api/admin-login` — there's no public entry point
into order data.

## AI customer-care chatbot

A floating chat widget (bottom-right, above the WhatsApp button) answers
questions grounded only in the site's actual product catalog, FAQ and
policies (`netlify/functions/lib/knowledge.js` — keep this in sync with
`PRODUCTS`/`FAQS`/the policy sections in `index.html` when they change). It
cannot look up a specific order — for order-specific questions, or anything
it can't answer from the grounding content, or an explicit "talk to a
human" request, it flags escalation and the widget surfaces a WhatsApp
handoff link pre-filled with the conversation so the Mandir doesn't start
from zero.

Needs `ANTHROPIC_API_KEY` (see Local development above). Runs on Claude
Opus 5 at `effort: "low"` — a workload-appropriate default for FAQ-style
chat per Anthropic's own guidance, not a quality downgrade; raise it in
`chat.js` if replies need to get sharper. Each message is a real API call —
`chat.js` caps message length, stored history length, and forces escalation
after a long conversation, since cost scales with usage.

## Coupons / discounts

A dismissible promo banner (top of the site) and a coupon field at checkout,
backed by real server-side validation — `netlify/functions/lib/coupons.js`
is the single source of truth used by both `validate-coupon.js` (live
checkout feedback) and `create-order.js`/`log-order.js` (the actual charge),
so a discount can never be forged client-side, same principle as the
server-computed price table.

Manage coupons entirely from `/admin` → Coupons: code, `%` or `₹` off, an
optional minimum order and max-discount cap, "new customers only" (checked
against paid-order history by phone number — there's no login system, so
phone is the closest thing to a customer identity), total usage limit, and
per-customer usage limit. Deactivating a coupon is a toggle, not a delete —
usage history (`used_count`/`used_by`) is preserved and can't be reset via
the save endpoint, so editing an existing coupon never silently erases real
usage data. A starter coupon (`WELCOME10` — 10% off, new customers only,
₹499 minimum, ₹150 max discount, one use per phone) was created through
this same admin flow, not seeded in code.

## Financials (estimated P&L)

`/admin` → Financials shows Gross Revenue (paid+ orders) minus estimated
Razorpay fees, packaging costs, shipping costs and refunds issued, down to
an **Estimated Net Profit**. It's clearly labelled as an estimate, not exact
accounting — two real costs aren't available automatically: Razorpay's exact
per-transaction fee isn't queryable without extra API scope, and Shiprocket's
real courier cost isn't known until a courier is manually assigned in their
dashboard (this project deliberately doesn't automate that step — see
Shipping below). Instead, set a fee % and default packaging/shipping cost in
the Financials settings form (`admin-financial-settings.js` /
`admin-save-financial-settings.js`, stored in Blobs), and optionally override
packaging/shipping cost per order from the Orders tab as real costs become
known — the P&L gets more accurate over time without ever requiring it.

## Customer accounts (phone OTP login)

A "Sign In" button in the header lets a customer verify their phone number
via **Firebase Phone Auth** (`firebase-auth-compat.js`, invisible reCAPTCHA +
real SMS OTP — Firebase handles OTP send/verify, this site never stores a
code itself) and get a signed-in session (30-day cookie, separate from and
independent of the admin session — see `lib/auth.js`). Signed in, checkout
auto-fills from the saved name/email/address and a "My Orders" page
(`my-orders.js`) lists that phone number's past orders. Checkout itself stays
**guest-friendly** — login is never required to buy — and after any
successful order (Razorpay or WhatsApp path) the account's saved details are
refreshed from that order automatically.

Coupon logic is intentionally unaffected by accounts: "new customer" coupons
already worked before login existed, and still work the same way — checked
against paid-order history by phone number (`lib/coupons.js`) — since phone
is the one identity every order already carries, logged in or not.

**Setup required before this works (not yet done automatically):**
1. [console.firebase.google.com](https://console.firebase.google.com) →
   create a project → **Authentication** → Sign-in method → enable **Phone**.
2. Project settings → General → add a **Web app** → copy the config object
   (`apiKey`, `authDomain`, `projectId`, `appId`) into `index.html`'s
   `CONFIG.FIREBASE` (search for `PASTE_FIREBASE`). These are public,
   client-side-safe values — same trust level as `CONFIG.RAZORPAY_KEY`.
3. Project settings → **Service accounts** → Generate new private key (JSON)
   → set it as the `FIREBASE_SERVICE_ACCOUNT` env var (the actual secret —
   server-side only, verifies ID tokens in `lib/firebase-admin.js`).
4. Authentication → Settings → **Authorized domains** → add your real domain
   (and the `*.netlify.app` preview domain for testing) — phone auth silently
   fails from an unauthorized domain.

## Shipping (Shiprocket)

Once a Razorpay payment is verified, `verify-payment.js` automatically
creates a matching order in Shiprocket (`netlify/functions/lib/shiprocket.js`)
and logs the result into that order's activity history — visible in
`/admin`. WhatsApp-path orders aren't auto-verified paid, so they get a
"Create Shiprocket Order" button in the admin panel instead
(`admin-create-shipment.js`); a failed auto-creation shows the same button
as "Retry Shiprocket".

**Deliberate scope boundary:** this only *creates* the Shiprocket order
(free). Assigning a courier/AWB and scheduling pickup — the step that
commits to real courier charges — is left as a manual action in the
Shiprocket dashboard, not automated here.

**Setup required in the Shiprocket dashboard before this works:**
1. Add at least one **Pickup Address** (Settings → Pickup Addresses) — its
   exact nickname is `SHIPROCKET_PICKUP_LOCATION`.
2. Create a dedicated **API User** (Settings → API → Add New API User) —
   use *that* user's email/password for `SHIPROCKET_EMAIL`/
   `SHIPROCKET_PASSWORD`, not your main login. Copy the password immediately
   — Shiprocket only shows it once.

**Known gap:** the order-creation API requires per-package `length` /
`breadth` / `height` / `weight`, which the product catalog doesn't track.
`lib/shiprocket.js` uses one fixed default (15×12×5cm, 0.3kg) for every
order regardless of contents — safe for any single item or small combo in
this catalog, but worth replacing with real per-product weights once actual
shipments show what's accurate. Similarly, checkout doesn't collect a
"state" field (Shiprocket requires one) — `lib/shiprocket.js` resolves it
from the PIN code via India Post's public lookup
(`api.postalpincode.in`), falling back to the city name if that lookup
fails for some reason.

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
6. ~~Customer-facing order tracking~~ — done: phone-OTP login + "My Orders"
   (see Customer accounts above) lets a signed-in customer see their own
   order history and status. Self-service **return/cancellation requests**
   (vs. today's WhatsApp-to-admin flow) are still a natural next step.
