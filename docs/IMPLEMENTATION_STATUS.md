# Implementation and verification status

Prepared October 15, 2026; repository references updated October 16, 2026. The application destination is [SapceDandy/regulars_app](https://github.com/SapceDandy/regulars_app); the separate concept destination is [SapceDandy/regulars_brain](https://github.com/SapceDandy/regulars_brain). Both user-created repositories were discovered through the connected GitHub account. This application source is intended for regulars_app, with the existing public visibility preserved. Remote publication does not establish live deployment or provider readiness.

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
- Browser visual/accessibility/device QA. Browser control was unavailable, so UI source and HTTP flows were checked without screenshots or browser automation.

## Not implemented in this release

Real POS or external reservation/waitlist vendor connections; automatic stock inference; independent merchant onboarding and settlement; recurring subscriptions and customer billing portal; group/member guest delegation; admin venue/editor/staff invitation UI; support/account recovery and self-service data deletion; notification email for leads; outbound campaign/reminder sending; conversion analytics; proximity sensing; richer AI agents; sports feed licensing or live score automation.

Sample schedules are invented for tests and must not be mistaken for an official sports schedule. Sample businesses are fictional, not signed partners. Price/capacity choices are proposed defaults. No field results, physical installation, revenue increase, legal clearance or production readiness are claimed.
