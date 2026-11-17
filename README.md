# Player Books — Player Bio Site

A private, searchable library of the 382 player evaluations from the eight
Player Books (ULM, CAA, Southland, MVFC, Big Sky, SoCon, NEC, OVC-Big South):
search and filter the directory, open a full page per player — bio, band,
closest matches, The Call, fits, best/worst, injury and transfer record,
verified speed evidence, and the qualified NCAA eligibility determination
with its basis. Where the qualified determination differs from the book's
printed status, the player page shows both.

Plain static files plus two small Vercel functions. No build step, no
framework, no database.

## Deploy to Vercel

1. Create a project in Vercel and drag this whole folder into it (or run
   `vercel deploy` from inside this folder).
2. In the project's **Settings → Environment Variables**, add one variable:
   - **Name:** `SITE_PASSWORD`
   - **Value:** the password you choose (it exists only here — it is never
     written into any file in this folder)
   - Apply it to the Production environment (and Preview too, if you want
     preview deployments gated as well).
3. Redeploy once after setting the variable. Done — the site is live behind
   the password.

## How the password gate works

- `middleware.js` (Vercel Edge Middleware) intercepts **every** path —
  pages, `players.json`, and every headshot image. Without a valid sign-in
  cookie, the request is redirected to `/login`.
- `login.html` + `api/login.js` check the submitted password against
  `SITE_PASSWORD` (constant-time comparison of SHA-256 digests). On success
  they set an HttpOnly, Secure, SameSite=Lax cookie carrying a SHA-256 token
  derived from the password — the password itself is never stored in the
  cookie or anywhere on disk. The cookie lasts 30 days.
- A wrong password gets a plain "Incorrect password" and nothing else.
- If `SITE_PASSWORD` is ever unset, the gate fails closed: nobody can sign
  in until it is set again.
- All pages also carry `noindex` headers/meta, so search engines stay out.

**Alternative:** Vercel's own built-in password protection (Project Settings
→ Deployment Protection) can gate the deployment instead of — or in addition
to — this middleware, if your Vercel plan includes it. If you use it, keep
this gate too or remove `middleware.js` and `api/login.js`; do not run the
login page without one of the two protections in place.

## Updating the data later

1. Replace `players.json` (and add/replace images in `headshots/`, named by
   player record id, e.g. `jane-doe.jpg`).
2. Redeploy the project (drag the folder in again, or `vercel deploy`).
   No code changes are needed — the directory, filters and player pages are
   all driven by `players.json` at load time.

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js`, `styles.css` | The directory + player pages (hash-routed, one shareable URL per player: `/#/player/<id>`) |
| `players.json` | All 382 player records, incl. the qualified eligibility determination and basis |
| `headshots/` | 376 player headshots (6 players have none — the site shows an initials tile, never a stand-in photo) |
| `login.html`, `api/login.js` | Sign-in page and the password check |
| `middleware.js` | The gate itself — runs on Vercel's edge before any file is served |
| `vercel.json` | `noindex` header for every path |
