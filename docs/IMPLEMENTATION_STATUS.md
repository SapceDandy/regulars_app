# Implementation and verification status

## November 1 — payment rehearsal and accessibility audit

Actual Regulars Stripe sandbox checkout and CLI-forwarded signed webhooks passed against an isolated local test fixture: activation, decline, 3D Secure retry, duplicate/tampered events, partial/full refunds, manager review, cancellation and hold release. All sandbox payments were refunded and unused sessions expired. A reusable opt-in procedure is in [tests/manual/README.md](../tests/manual/README.md). Hosted return URLs and Vercel webhook delivery remain separate gates.

The hosted dialog audit found missing accessible names. Shared dialogs now associate their visible heading with the native dialog. Keyboard Tab and Escape behavior were exercised; this is not physical-device or screen-reader acceptance. Syntax checks, all 155 tests and 100% measured runtime line/branch/function coverage pass. The dependency audit reported zero known vulnerabilities. Overall planning progress remains 13 of 20 workstreams (65%); provider, device, hosted-operations and venue-acceptance gates remain open. No production promotion is included.

Prepared October 15, 2026; repository references updated October 16, 2026. The application destination is [SapceDandy/regulars_app](https://github.com/SapceDandy/regulars_app); the separate concept destination is [SapceDandy/regulars_brain](https://github.com/SapceDandy/regulars_brain). Both user-created repositories were discovered through the connected GitHub account. This application source is intended for regulars_app, with the existing public visibility preserved. Remote publication does not establish live deployment or provider readiness.

## Vercel preparation — October 30, 2026

Vercel project `regulars-app` and Neon database `regulars-pilot-db` are provisioned and linked for preview/production. The new adapter uses PostgreSQL and request-scoped pools, authenticated cron, and durable job leases. Local demo remains localhost-only. Live-provider preview requires Stripe test credentials; missing configuration returns 503. An explicitly enabled, Vercel-authenticated synthetic preview now supports testing without provider accounts in a separate regulars_pilot schema.

Local test evidence covers SQLite and embedded PostgreSQL. Real Neon concurrent workers, Vercel raw webhook forwarding, cron execution, SMS receipt, real Stripe sandbox delivery and native Wallet devices still require hosted verification. Stripe/Twilio credentials and operator-reviewed venue configuration are absent; full live deployment remains blocked. See [Vercel setup](VERCEL.md).

## Synthetic hosted pilot — October 30, 2026

The protected preview now runs guest/manager fixtures, simulated checkout and refunds, and persistent Neon transactions. Hosted browser testing covered discovery, memberships, season reservations, resource exclusion, queues, bottle service, role denial, inquiry and promotion approval. Narrow-phone navigation, search counts and pass dates were corrected. The October 31 follow-up brings both database test suites to 60 passing tests, adds profile/FAQ/calendar browser evidence, protects unsaved edits from background refresh, and improves mobile staff navigation. The next round verified private locker allocation, early-renewal rejection, unpaid-hold cancellation and party-size adjustment. Dialog errors now stay inside the open dialog, cancelled/expired checkout headings reflect their state, guest counts use singular/plural copy, and disabled Wallet controls explain the test limitation. Hosted rechecks for this last UI change are recorded in the pilot report. This does not verify real payments, SMS or native Wallet delivery. Square is not implemented; the existing payment adapter is Stripe. See [pilot test report](PILOT_TEST_REPORT_2026-10-30.md).

## Implemented and exercised locally

| Area | Evidence |
| --- | --- |
| Venue discovery/enrollment | Responsive source pages and API; HTTP metadata and access checks |
| Phone account | Local random-code journey; live Twilio request/response adapter tested with mocks |
| Membership / locker | Guest upgrade, physical modes, payment activation, expiry and manual renewal tests |
| Game bookings | Single game, group size, overlapping windows, all-or-none season allocation |
| Capacity races | Two worker processes compete for one resource; one succeeds and one receives conflict |
| Checkout / refunds | Signature verification, amount/session checks, idempotency, held inventory, late-payment compensation, cancellation and pending-refund regressions |
| Wallet data | Apple/Google payloads update after stock changes and expiration |
| Apple package | ZIP manifest hash checks and detached PKCS7 verification with a temporary self-signed fixture |
| Google save | RS256 JWT verification against a temporary test key |
| Staff service | Role/venue isolation, bottle receiving, retry-safe pours, bounds and manager corrections |
| Priority | Steep prices, four-slot cap, disabled venues, expiry back to standard |
| Delivery | Persistent retry jobs preserve service records while providers are unavailable |
| Campaigns / FAQ | Draft/approve/copy workflow and bounded policy-based answers |
| Deployment guards | Production blocks demo mode; live startup blocks synthetic databases |

Run `npm run check` and `npm test` for current results. The final build records its exact run in VALIDATION.md.

## Not verified against live services

- Actual Twilio SMS receipt, provider fraud controls and carrier delivery.
- Actual Stripe Checkout, webhook delivery, disputes and bank-settled refunds.
- Apple certificate trust, iPhone installation, APNs connection and device refresh.
- Google issuer/class permissions, Android saving and remote object updates.
- Live host/TLS configuration, backups/restore, payment reconciliation and staff rehearsal.
- Full accessibility audit and real-device QA. Hosted Chromium browser workflows and responsive frame checks were completed October 30; see the pilot report.

## Not implemented in this release

Real POS or external reservation/waitlist vendor connections; automatic stock inference; independent merchant onboarding and settlement; recurring subscriptions and customer billing portal; group/member guest delegation; admin venue/editor/staff invitation UI; support/account recovery and self-service data deletion; notification email for leads; outbound campaign/reminder sending; conversion analytics; proximity sensing; richer AI agents; sports feed licensing or live score automation.

Sample schedules are invented for tests and must not be mistaken for an official sports schedule. Sample businesses are fictional, not signed partners. Price/capacity choices are proposed defaults. No field results, physical installation, revenue increase, legal clearance or production readiness are claimed.
