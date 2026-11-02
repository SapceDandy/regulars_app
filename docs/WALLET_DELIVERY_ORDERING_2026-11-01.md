# Wallet delivery ordering — November 1, 2026

## Defect reproduced and fixed

Two staff pours can enqueue two Wallet updates for the same member. Previously,
the outbox lease protected only each job ID. Two workers could claim those
different jobs, read different bottle balances, and finish out of order.

The new regression reproduced a 750 mL bottle receiving two 45 mL pours. A slow
first delivery read 705 mL; a second worker delivered 660 mL; the first then
finished and overwrote the simulated provider state with 705 mL. The database
balance itself stayed correct. This was a delivery-ordering defect, not a second
stock debit or an observed live Apple/Google incident.

The claim query now skips jobs whose delivery kind and subject already have an
unexpired lease. The claim remains inside the existing serialized transaction;
no provider call occurs inside that transaction. Other members and delivery
kinds can proceed. Failed/expired leases remain recoverable. No schema change,
dependency update or new credential is required.

## Verification

| Scenario | Result |
| --- | --- |
| Delayed Wallet update followed by a second pour | Reproduced failure before the fix: 705 mL instead of 660 mL; passes after the fix |
| Another member while the first delivery is blocked | Other member completes; the blocked member's new job waits |
| Same subject, different delivery kind | Refund delivery proceeds while the Wallet lease is active |
| Expired subject lease | Both queued Wallet jobs complete at expiry; leases are removed |
| Full local suite | 169 passed, zero failures/skips |
| Focused SQLite and PostgreSQL/PGlite regressions | Both new tests passed on each backend |
| Runtime coverage | 100% lines, branches and functions across 22 files |
| Syntax | 54 JavaScript files plus explicit syntax validation of the manual hosted script |
| Hosted Supabase rehearsal | 14 checks passed, including two new ordering/recovery checks and the prior 12 regression scenarios |

The hosted ordering check used independent Node child processes with separate
PostgreSQL pools. One process read a 150 mL snapshot and paused. A second pour
reduced stock to 140 mL and another member queued an update. The second process
updated that other member while leaving the blocked member's job pending. After
release, the first process completed both updates; the simulated remote state
ended at 140 mL. A separate check verified that two jobs for one subject remained
pending during an active lease and completed when it expired.

Hosted source: `e8fb2210a0136127e63e50ca5d129365fb8305e1`.
[Vercel deployment](https://vercel.com/sapcedandy-s-team/regulars-app/FzaXr17tTqXn8dcjUqMo5aot1sxp)
is READY, with 14 `HOSTED PASS` results and successful fixture cleanup.
[GitHub CI](https://github.com/SapceDandy/regulars_app/actions/runs/41368413669)
completed successfully, including locked installation, syntax, complete runtime
coverage and the full PostgreSQL/PGlite application suite.

An independent database query confirmed zero business rows in both the provider
and disposable rehearsal schemas. The rehearsal flag is disabled. KUDJO,
production and the older synthetic Neon preview are unchanged.

## Boundaries and remaining work

This verifies application worker ordering over the hosted database with a
simulated provider. No Apple/Google endpoint, phone, payment or public HTTP cron
was called. The five-minute lease is not an external-provider fencing mechanism
after expiry; delivery remains at least once and requires provider idempotency.
Physical Wallet saving, updates and provider failure behavior still need actual
account/device tests.

The Twilio auth token, Stripe/Square webhook secrets, reviewed venue settings
and Wallet signing configuration are still absent from the provider-pilot
environment. Whole-workstream readiness remains 13/20 (65%). The fix and added
evidence improve Wallet and operations reliability without completing those
external acceptance gates.
