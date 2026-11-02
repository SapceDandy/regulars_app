# Regulars pilot verification and current functionality

Updated November 1, 2026.

## Progress estimate

**65% of overall pilot verification**, using the existing 20 equally counted workstreams: 13 have automated and/or synthetic browser evidence; seven still require external or operational validation. A workstream earns credit only when its stated scope is verified; partial work does not change the numerator. This is a planning estimate, not measured code coverage, percentage of test cases discovered, hours remaining, or production readiness. A workstream marked exercised is scoped to the evidence below, not a claim of exhaustive testing.

The actual Stripe and Square sandbox rehearsals, hosted keyboard audit, server-only Wallet secret support, admin authorization checks and new Supabase contention/recovery rehearsal materially improve the evidence, but none completes an entire remaining workstream. The denominator remains 20; Square/POS verification is included in payment-provider acceptance. Passing 167 automated tests or reaching 100% measured runtime coverage does not make overall pilot verification 100%.

| # | Workstream | Evidence/status |
| --- | --- | --- |
| 1 | Venue discovery and published inventory | Synthetic browser/API checks |
| 2 | Free enrollment and paid membership activation | Synthetic checkout/account checks |
| 3 | Shared/private locker allocation | Automated capacity/access checks and hosted fixtures |
| 4 | Expiration and renewal lifecycle | Automated clock-boundary, cancellation and abandonment checks |
| 5 | Single-game booking and price windows | Automated rules and hosted checkout |
| 6 | Season allocation and conflicts | Automated atomicity and hosted season workflow |
| 7 | Simulated payment, cancellation and refund states | Local signature fixtures and synthetic browser journeys; real Stripe is separate below |
| 8 | Standard and paid-priority queues | Automated cap/price rules and hosted queue workflows |
| 9 | Staff roles and venue isolation | HTTP/domain access-denial tests and hosted checks; additional local SQLite/PGlite role-injection, concurrent revocation/demotion and stale-form tests pass |
| 10 | Bottle records, stock bounds and audit | Automated guards/idempotency and hosted service/correction |
| 11 | Account profile, calendar and venue FAQ | Hosted edit/reload, download and question checks |
| 12 | Business inquiry and campaign approval/copy | Synthetic browser evidence; no outbound messages |
| 13 | Desktop/responsive UI regressions | Chromium frame evidence and delayed-response tests; actual devices are separate below |
| 14 | Real SMS sign-in and delivery | Partial: separate Regulars Verify service created and its identifiers deployed. Open: auth token and actual controlled-phone verification |
| 15 | Real payment provider journey | Partial: actual Stripe sandbox checkout, decline, 3DS, signed CLI-forwarded delivery, duplicate/tamper checks, cancellation, partial/full refunds and inventory release passed. Square API sandbox capture, retry/conflict, decline, cancel and partial/full refunds also passed. Open: hosted return/webhook flow, actual disputes/delayed payments and Square provider-to-app delivery/staff matching |
| 16 | Apple Wallet | Partial: server-only PEM configuration and cryptographic fixture tests pass. Open: paid membership/certificate setup, actual hosted signing, iPhone saving and updates |
| 17 | Google Wallet | Partial: server-only PEM configuration and cryptographic fixture tests pass. Open: Cloud access, service account/class setup, Android saving and updates |
| 18 | Hosted operational resilience | Partial: 12 Supabase checks passed from Vercel using independent processes/pools, including contention, rollback, leased jobs and an in-memory logical restore. Open: multiple serverless invocations, authenticated HTTP cron, retained backup/PITR recovery, load/monitoring |
| 19 | Real-device and accessibility acceptance | Partial: hosted Chromium keyboard dialog audit found and fixed accessible naming; Tab/Escape/focus behavior checked. Open: physical iOS/Android, touch, screen-reader acceptance and broader accessibility audit |
| 20 | Venue/operator acceptance | Open: reviewed inventory, prices, policies/support, staff rehearsal and approved merchant arrangement |

Current local automated evidence: 167/167 passed, no failures/skips; syntax/JSON passed for 53 JavaScript files, with both new manual scripts checked separately. The latest runtime coverage gate passes across 22 files at 100%. PGlite is embedded PostgreSQL, and SQLite-specific backup/process tests still use SQLite. Neither local suite proves hosted multi-instance behavior. The new [hosted database and Stripe identity report](HOSTED_REHEARSAL_2026-11-01.md) records real Supabase contention evidence and the separate Regulars Stripe sandbox account check; it does not claim public HTTP or provider webhook verification. The four additional admin scenarios also pass on PGlite; see [admin verification](ADMIN_VERIFICATION_2026-11-01.md). Payment, Wallet generation and persona scenarios are detailed in [the follow-up report](PAYMENT_WALLET_PERSONA_TESTS_2026-11-01.md).

## Current application flow

1. A guest browses venue pages, plans, published games, inventory and venue policies. Current preview venues, prices and games are fictional test fixtures.
2. The guest signs in and enrolls in a free guest pass or a fixed-term shared/private locker membership. Paid terms renew manually; a guest pass does not include locker storage or reserved seating. Preview sign-in uses synthetic personas and checkout simulates payment. Actual Stripe sandbox payments passed against an isolated local fixture; hosted provider flow and real SMS remain unverified.
3. Game booking chooses a published game, table/bar seat and party size. Season purchase allocates the same resource across the listed upcoming games atomically. Server pricing can rise nearer kickoff. A 31-minute checkout hold prevents competing purchases; only verified payment grants live access.
4. The account shows membership, locker, recorded bottle balance, upcoming reservations, queue status, purchase/refund state, profile preferences and calendar download. Native Wallet buttons remain disabled in synthetic testing.
5. Staff look up a member code while signed in to the correct venue. They receive bottles, record pours or corrections, check arrivals and release no-shows after the grace period. Service requires active membership and a current locker allocation. Positive stock corrections require a manager. Physical service and ID checks remain staff responsibilities.
6. Guests can join a standard walk-in queue and, where enabled, buy one of four escalating priority slots. Staff call and seat groups; priority never replaces an existing reservation or guarantees a wait time.
7. Managers see operating counts, unfinished delivery/refund jobs and reviewable campaign drafts. Approved copy can be copied into an existing marketing workflow. Inquiries are stored for manual review; the app does not email them automatically. The FAQ answers from predefined venue facts.
8. Committed stock/membership changes queue Wallet refreshes; failed deliveries retry and can be recovered by a manager. Real Apple/Google delivery remains unverified.

## Important current boundaries

- Stripe is the implemented checkout adapter. Square has a verified-signature completed-payment inbox and explicit staff bottle-service matching. Actual Square provider API sandbox scenarios passed in API Explorer; delivery into the hosted Regulars inbox and staff matching using those events remain unverified. See [Square rehearsal evidence](SQUARE_SANDBOX_REHEARSAL_2026-11-01.md).
- Venues and staff are configured by the operator. Self-service venue onboarding, independent merchant settlement/payouts and recurring subscriptions are not implemented.
- No automatic promotional SMS/email, live sports feed, automatic drink rewards, social/member-following system or influencer marketplace is implemented in this release.
- Production is not released. Complete the seven open workstreams before claiming the real-business pilot is fully verified.

## November 1 coverage update

All 19 runtime JavaScript files now have 100% native V8 line, branch and function coverage; 124 tests pass on SQLite and the bounded PostgreSQL/PGlite suite, and GitHub CI passes. The new protected preview passed a fresh simulated ticket purchase/refund and manager totals/job-queue checks. This strengthens the existing exercised categories without completing the seven external/operational gates; the approximate 65% workstream estimate remains unchanged. See [the detailed coverage and pilot report](COVERAGE_AND_PILOT_2026-11-01.md).

## November 1 partial-refund review follow-up

Managers now have an audited Payment reviews queue for partial refunds. Additional refunds reopen review, stale amounts are rejected, and full refunds close the task. Customer histories and manager totals reflect recorded refunds. Both database suites pass 140 tests with complete measured runtime coverage. This historical checkpoint is superseded by the dispute/Square/operator work described below. Actual provider/device verification remains open. See [refund review fixes](REFUND_REVIEW_FIXES_2026-11-01.md).

## November 1 open-item follow-up

Dispute snapshots and payment exceptions now reach a manager/operator review workflow. Square payments require explicit staff confirmation before one idempotent stock adjustment. Managers can revoke staff access, and the operator can provision roles while preserving the last manager. See [completion evidence and remaining gates](PILOT_OPEN_ITEMS_2026-11-01.md). These code/test improvements do not complete real provider, device, hosted resilience or venue acceptance gates; the existing workstream estimate is unchanged.
