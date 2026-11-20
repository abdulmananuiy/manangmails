# Private Email Platform

A private, Gmail-style email application on your own domain: username/password
accounts, generated addresses, persistent inboxes, OTP detection and a private
admin panel. Built from `Private_Email_Platform_A_to_Z_Guide.pdf`.

> **Stack note:** the guide describes a PHP + MySQL app for InfinityFree.
> This build targets **Vercel**, which does not run PHP or MySQL, so the same
> features are implemented as a **Next.js App Router** app with **Vercel
> Serverless Functions** (route handlers) and **PostgreSQL** (via
> `DATABASE_URL`). No PHP, no MySQL, no InfinityFree dependency.

## Current status — read this first

- **Domain:** `manangmails.is-a.dev` (chosen 2026-11-21). Registration pull
  request **https://github.com/is-a-dev/register/pull/62166** ("Add
  manangmails.is-a.dev", #62166, Open, owner `abdulmananuiy`, CNAME →
  `cname.vercel-dns.com`, NO MX yet) is awaiting maintainer approval, which
  usually takes days. **The domain is NOT live yet.** Caveat from the
  registration task: the PR description template was submitted as-is
  (checkboxes/purpose/preview/ToS fields unfilled) — maintainers may ask for
  it to be completed.
- **Receiving: NOT CONFIGURED.** No mail receiver is connected (Route C in the
  guide). Generated addresses **cannot receive mail yet**. The dashboard and
  the admin receiver panel say this honestly, and the app never claims
  otherwise. Do not share generated addresses as working inboxes until a
  receiver is connected and a real test email arrives.
- **What works now:** signup/login, address generation on
  `manangmails.is-a.dev`, inbox + message viewer, OTP detection, saved
  addresses, settings, admin panel, and the secure inbound-email API
  (`POST /api/inbound-email`) — ready for a receiver to post signed events to.

## Quick start (local)

```bash
cp .env.example .env.local   # fill in DATABASE_URL, SESSION_SECRET, INBOUND_API_SECRET, SETUP_TOKEN
npm install
npm run db:init              # create DB + apply db/schema.sql
npm run dev                  # http://localhost:3000
```

Create the first admin (one-time, only while no admin exists):

```bash
curl -X POST http://localhost:3000/api/setup \
  -H 'Content-Type: application/json' \
  -d '{"setupToken":"<SETUP_TOKEN>","username":"admin","password":"<strong-password>"}'
```

## Deploying to Vercel

1. Create a hosted Postgres database (Neon, Supabase, or Vercel Postgres) and
   copy its connection string.
2. In Vercel: import this repository, framework preset **Next.js**.
3. Set environment variables (see `.env.example`):
   - `DATABASE_URL` — Postgres connection string (required). If your provider
     needs SSL, also set `DATABASE_SSL=require`.
   - `SESSION_SECRET` — ≥ 32 random characters (required).
   - `INBOUND_API_SECRET` — shared secret for `/api/inbound-email` (required).
   - `SETUP_TOKEN` — one-time admin setup token (required for first setup).
   - `RECEIVER_MODE` — `none` (default) until a receiver is connected.
4. Deploy. Then run the schema once against the hosted database:
   `DATABASE_URL=<hosted-url> npm run db:init`
5. Create the first admin via `POST /api/setup` (see above), then delete or
   rotate `SETUP_TOKEN` — the endpoint is disabled once an admin exists.
6. Add the custom domain in Vercel (Domains) **after** the is-a.dev subdomain
   is approved, and point its DNS to Vercel (`CNAME → cname.vercel-dns.com`).

## Connecting email receiving (Route A or B)

1. Choose a receiver: a self-hosted mail server (e.g. Postfix, Route A) or an
   inbound email provider (Route B).
2. Add the **exact** MX/TXT records the receiver supplies for
   `manangmails.is-a.dev`. Do not guess record values. SPF/DKIM/DMARC
   authenticate mail; they do not replace MX.
3. Configure the receiver to POST signed JSON events to
   `https://<your-app>/api/inbound-email` with header `x-api-secret`
   (`INBOUND_API_SECRET`) or an HMAC-SHA256 signature of the raw body in
   header `x-signature`.
4. Set `RECEIVER_MODE=provider` (or `selfhosted`) and set
   `receiver_status=CONNECTED` in Admin → Settings **only after a real test
   email appears in the correct inbox**.
5. Send a real test email to a generated address and confirm it appears.

Event format for `/api/inbound-email`:

```json
{
  "eventId": "provider-event-123",
  "recipient": "abc123@manangmails.is-a.dev",
  "sender": "security@example.com",
  "subject": "Your verification code",
  "messageId": "<unique-id@example.com>",
  "textBody": "Your verification code is 482913.",
  "htmlBody": "<p>Your verification code is <b>482913</b>.</p>",
  "receivedAt": "2026-11-21T01:00:00.000Z"
}
```

Responses: `200` stored, `400` validation, `401` bad signature,
`404` unknown/deactivated recipient, `409` duplicate messageId,
`413` too large, `503` maintenance / not configured.

## Security model

- Passwords: bcrypt hashes only (`bcryptjs`, cost 12). Never plaintext, never
  shown to admins.
- Sessions: HMAC-signed, HttpOnly, SameSite cookies; separate user/admin
  sessions; session IDs regenerate on login.
- CSRF: session-bound token on every state-changing request.
- SQL: parameterized queries only (`pg`).
- HTML mail: sanitized at ingest (`sanitize-html`) — no scripts, no event
  handlers, no remote images, no forms/iframes.
- Inbound API: shared-secret or HMAC signature, timestamp/replay window,
  duplicate message-ID rejection, size limits, per-IP rate limiting.
- Rate limits: login/signup/address-generation/inbound API are rate-limited
  (in-memory per instance — see `src/lib/rate-limit.ts`).
- Secrets live only in environment variables. Nothing secret is in the repo
  or in client JavaScript.

## Project layout

```
db/schema.sql                 Postgres schema (8 tables, FKs, indexes, uniques)
src/lib/                      db, auth, csrf, otp, sanitize, rate-limit, audit
src/app/                      pages: /, login, signup, dashboard/*, admin/*
src/app/api/                  auth, addresses, messages, otp, settings,
                              admin/*, inbound-email, setup, health
scripts/db-init.mjs           create DB + apply schema
scripts/test.mjs              local test plan (guide section 16, no receiver)
```

## Testing

```bash
npm test        # boots the dev server and runs the section 16 test plan
npm run build   # production build (must pass before deploying)
```

Tests cover: signup, duplicate signup, wrong-password login, address
generation + uniqueness, inbound API auth/dedupe/unknown-recipient, OTP
detection (including the bare-number false-positive check), HTML
sanitization, admin access denial for normal users, CSRF rejection, and
logout. Tests that need a live receiver (real external email) are marked
**not tested** until a receiver is connected — see `BUILD_LOG.md`.
