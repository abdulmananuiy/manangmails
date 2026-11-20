# Build log — Private Email Platform

## 2026-11-21 ~01:08 PKT — Build started
- Spec: `~/workspace/user/files/Private_Email_Platform_A_to_Z_Guide.pdf` (read in full).
- User instruction: build COMPLETE, host on Vercel.
- Stack decision: the guide's PHP + MySQL/InfinityFree design cannot run on
  Vercel, so the same features were built as Next.js App Router + Vercel
  Serverless Functions (route handlers) + hosted Postgres via `DATABASE_URL`.
  No PHP, no MySQL, no accounts created, no money spent, nothing deployed by
  the builder (deployment is the parent agent's step).

## Domain
- 2026-11-21 01:13 PKT: user chose a NEW FREE domain, then an is-a.dev subdomain.
- 2026-11-21 01:14 PKT: subdomain name chosen: **manangmails** →
  `manangmails.is-a.dev`. Availability checked via GitHub API (01:15 PKT):
  `domains/manangmails.json` does not exist in is-a-dev/register (404) —
  appears free; final confirmation only on PR merge.
- Registration (GitHub PR to is-a-dev/register, CNAME → cname.vercel-dns.com)
  is in progress in a separate browser task. **PR OPEN:
  https://github.com/is-a-dev/register/pull/62166** ("Add manangmails.is-a.dev",
  #62166, Open, owner abdulmananuiy). NO MX records yet — receiver route not
  chosen. Caveat: the PR description template was submitted as-is
  (checkboxes/purpose/preview/ToS unfilled) — maintainers may ask for it to be
  completed. Approval usually takes days; the domain is NOT live yet.
- Default `platform_settings.domain` is set to `manangmails.is-a.dev`
  (configurable in Admin → Settings). The domain is NOT live yet.

## Receiving status (Route C — honest)
- Receiving: **NOT CONFIGURED**. No mail receiver is connected (no Route A
  self-hosted server, no Route B provider account). The dashboard and admin
  receiver panel show this, and generated addresses are labelled as unable to
  receive mail until a receiver is connected.
- The inbound API `POST /api/inbound-email` exists and is fully implemented
  (shared-secret or HMAC auth, dedupe by message ID, exact recipient
  mapping, OTP detection, correct HTTP codes) for when a receiver is connected.

## Files built
- `package.json`, `tsconfig.json`, `next.config.ts`, `.env.example`,
  `.gitignore`, `README.md`, `BUILD_LOG.md` (this file)
- `db/schema.sql` — 8 tables: users, admins, email_addresses, messages,
  otp_detections, receiver_events, platform_settings, audit_logs
  (foreign keys, indexes, unique constraints, seeded settings)
- `src/lib/` — db.ts (pg pool + settings), auth.ts (bcrypt + signed cookies),
  csrf.ts, otp.ts, sanitize.ts, rate-limit.ts, audit.ts, addresses.ts,
  api.ts (guards), client.ts (fetch helper)
- `src/app/` — landing, login, signup, dashboard (overview, inbox, message
  viewer, addresses, OTP, saved, settings), admin (login, overview, users,
  addresses, messages, receiver, settings, audit, logout)
- `src/app/api/` — auth (signup/login/logout/change-password/session),
  addresses, messages, messages/[id], otp, settings, admin (login/logout/
  session/overview/users/addresses/messages/settings/receiver/audit),
  inbound-email, setup (one-time first admin), health
- `scripts/db-init.mjs`, `scripts/test.mjs`

## Local verification
- `npm run build` — **PASS** (Next.js 15.5.29, 29 routes, type-check clean).
  One type error was found and fixed during the build (`logEvent` null arg in
  the inbound-email route).
- `npm test` (`scripts/test.mjs`, guide section 16, no live receiver) —
  **22 passed, 0 failed** (run 2026-11-21 ~01:50 PKT). Full list:
  1. Health reports Receiving: NOT CONFIGURED — PASS
  2. Signup with a new username succeeds (201) — PASS
  3. Signup with duplicate username rejected (409) — PASS
  4. Login with wrong password rejected (401) — PASS
  5. Login with correct password succeeds — PASS
  6. Generate address returns unique address on manangmails.is-a.dev — PASS
  7. Generate 5 more addresses — all unique — PASS
  8. Inbound API without secret rejected (401) — PASS
  9. Inbound API with secret stores message + detects OTP 482913 — PASS
  10. Replay of same receiver event rejected as duplicate (409) — PASS
  11. Inbound API with unknown recipient rejected (404) — PASS
  12. Bare numbers without OTP context are NOT detected as OTP — PASS
  13. Inbox lists the stored message — PASS
  14. OTP page lists detected code 482913 — PASS
  15. Unsafe HTML sanitized (no `<script>`, no remote `<img>`) — PASS
  16. Normal user denied admin API (401) — PASS
  17. Normal user denied admin overview (401) — PASS
  18. One-time admin setup works or is disabled (201/403) — PASS
  19. Admin login succeeds — PASS
  20. Admin can list users — PASS
  21. Admin state-changing request without CSRF token rejected (403) — PASS
  22. After logout, inbox is denied (401) — PASS
- Page smoke test (same run): all 13 HTML pages return 200
  (landing, login, signup, dashboard, inbox, addresses, OTP, saved,
  settings, admin overview/users/addresses/messages/receiver/settings/audit);
  `/api/settings` and `/api/admin/overview` return real JSON; landing,
  dashboard and admin receiver pages all show "Receiving: NOT CONFIGURED";
  zero errors in the dev-server log.
- **Test environment note:** `apt-get install postgresql` stalled (apt
  update hung on its mirrors for 10+ min), so local tests run against
  **pg-mem** (in-memory Postgres emulator, `PG_MEM=1`, devDependency only,
  never active on Vercel). The production path is unchanged real `pg` over
  `DATABASE_URL`. Two real pg-mem gaps were found and worked around in the
  test-only layer or in the SQL (valid Postgres either way):
  (a) pg-mem cannot resolve correlated subqueries (`EXISTS`/scalar `COUNT`
  referencing an outer alias) — those 5 queries were rewritten as
  `LEFT JOIN` derived tables, which is also valid and efficient on real
  Postgres; (b) pg-mem lacks `octet_length`/`length` — registered in the
  pg-mem instance in `src/lib/db.ts` (test-only branch). One real app bug was
  also found this way: the DB pool must be cached on `globalThis`, because
  Next.js dev mode can instantiate a module per route — a module-scoped
  pool gave each route its own empty in-memory database and made every
  login fail (fixed; irrelevant for real Postgres, but the pattern is the
  documented Next.js recommendation).

## Test results
- (See "Local verification" above — 22/22 PASS, build PASS, pages 200.)

## NOT done / needs the user or parent next
- Live deployment on Vercel (parent's step): import repo, set env vars,
  run `npm run db:init` against hosted Postgres, create first admin via
  `/api/setup`.
- Domain registration: is-a.dev PR #62166 approval (maintainers, usually
  days); then add the custom domain in Vercel and point DNS to Vercel.
  PR template caveat: description submitted as-is — maintainers may ask for
  it to be completed.
- Mail receiver (Route A or B): not chosen, not connected — receiving stays
  NOT CONFIGURED until then; a real external test email is still untested
  (guide's final acceptance rule).
- GitHub username: **abdulmananuiy** (confirmed 2026-11-21 01:25 PKT) — PR
  #62166 is already open under it.
