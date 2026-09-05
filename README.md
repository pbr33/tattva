# Shri Om Tattva

Temple-consecrated sacred articles ecommerce site — malas, rudraksha, yantras,
bracelets and puja essentials from Shri Chakra Sahitha Rudra Mahakali – Shri
Sarpaskanda Subrahmanya Mandir.

**Live checkout:** Razorpay (UPI / cards / netbanking / wallets) with a
WhatsApp-order fallback. Includes a Jyotish (rashi-based) product
recommendation engine.

## Structure

This is currently a **single-file site** — `index.html` contains all markup,
CSS and JavaScript, with product photos embedded inline as base64 so it needs
no build step and no asset pipeline. That's intentional for zero-friction
hosting (Netlify Drop, GitHub Pages, any static host), but see "Suggested
next steps" below if you want to break it apart as the project grows.

```
.
├── index.html      # the entire site
├── netlify.toml    # Netlify build/publish config
└── README.md
```

## Local development

No build step required. Just open the file or serve it locally:

```bash
# Option 1 — just open it
open index.html          # macOS
xdg-open index.html       # Linux

# Option 2 — serve it (recommended, avoids file:// quirks)
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Before going live — required edits

Open `index.html`, find the `CONFIG` object near the top of the `<script>`
block (search for `RAZORPAY_KEY`), and set:

```js
const CONFIG = {
  RAZORPAY_KEY: "rzp_live_XXXXXXXX",   // from razorpay.com dashboard
  WHATSAPP: "91XXXXXXXXXX",             // Mandir's WhatsApp, country code + number
  ...
};
```

Everything else (products, prices, testimonials, FAQ) is also editable in
that same `<script>` block — search for `const PRODUCTS = [` etc.

## Deploy

### Netlify (recommended, already configured)
Connect this repo at [app.netlify.com](https://app.netlify.com) → "Add new
site" → "Import an existing project" → pick this repo. `netlify.toml` already
tells it to publish the root with no build command. Every push to `main`
auto-deploys.

### GitHub Pages
Settings → Pages → Deploy from branch → `main` → `/ (root)`.

## Suggested next steps for Claude Code

The single-file approach works well for a simple storefront but will get
harder to maintain as you add features. Natural next steps, roughly in order
of value:

1. **Split the file** — pull the `<style>` into `styles.css` and the
   `<script>` into `app.js`. Move product photos to `/images` and reference
   them by path instead of base64 (cuts the file from ~1.4MB to a few KB of
   markup + lazily-loaded images).
2. **Move `PRODUCTS` to a JSON/CMS** — right now the catalogue is a
   hardcoded JS array. A `products.json` (or a real backend / headless CMS)
   makes it editable without touching code.
3. **Real order backend** — checkout currently completes via the Razorpay
   client-side flow or a WhatsApp deep link. For production you'll want a
   server to verify Razorpay payment signatures and persist orders (a
   Netlify Function or a small Node/Express service would both work well
   here).
4. **Real testimonials** — the three testimonials in the Testimonials
   section are placeholders (there's a `NOTE FOR THE MANDIR` comment above
   them in the code) — replace with real devotee reviews before launch.
5. **Analytics** — no analytics are wired up yet; consider Plausible or GA4
   if you want visibility into traffic and conversion.
