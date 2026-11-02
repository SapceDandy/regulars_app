# Hosted pilot rehearsal — November 1, 2026 (America/Chicago)

The owner asked to continue testing. This round used a separate disposable schema
in the Regulars Supabase project, from Vercel Preview. KUDJO configuration,
production and the older synthetic Neon preview were unchanged.

## Results

All 12 hosted database/domain checks passed. Competing actions ran in independent
Node child processes, each with its own PostgreSQL pool through Supabase's
transaction pooler and certificate-verified TLS.

| Check | Observed result |
| --- | --- |
| Competing last-seat booking | One success, one 409; one reservation |
| Duplicate checkout retry | Both retries returned the same order |
| Duplicate bottle service | One 45 mL stock debit |
| Concurrent overdraw | One success, one 409; no negative balance |
| Synthetic Square service matching replay | One stock debit and one handling audit |
| Transaction rollback | Aborted update absent; subsequent connection usable |
| Simultaneous operator demotions | One success, one 409; one manager retained |
| Competing job workers | One delivery audit; no remaining lease |
| Expired worker lease | A new worker recovered and completed the job |
| Simulated delivery outage | Failure recorded; due retry completed |
| Logical snapshot/restore | All 29 table snapshots matched after restoration; stock remained 160 mL |
| Provider schema isolation | All provider-schema row counts unchanged |

The harness refuses nonempty business tables, checks the dedicated role/schema,
RLS and denied client grants, and claims a transactional ownership marker before
seeding reserved fictional phone numbers. Cleanup removed all fixture rows and
reset metadata. An independent Supabase query then confirmed zero business rows
in both `regulars` and `regulars_pilot`. The opt-in build flag was disabled after
the run. The 58 informational RLS-without-policy notices describe these
server-only tables; no client schema grants were added. See Supabase's
[RLS policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Stripe account isolation

A separate Preview build made one read-only `GET /v1/account` request using the
already-configured test secret in server memory. The response ID matched the
approved separate Regulars sandbox. The script rejects live keys, other branches
and non-Preview environments, disallows redirects, and logs only check outcomes.
It created no payment, customer or webhook. Its opt-in flag was disabled after
the passing result.

## Reproducible evidence

- Database rehearsal source: `3191402ee4f027e388a4124375e5028b28542a28`.
- Database build: [Vercel deployment](https://vercel.com/sapcedandy-s-team/regulars-app/GURn2WoqwqmNT5Ngebeu5xBBhh82), READY, twelve `HOSTED PASS` lines and successful cleanup.
- Stripe check source: `368b4914e8ba7d1fec303809dfcccdcb74954a8b`.
- Stripe build: [Vercel deployment](https://vercel.com/sapcedandy-s-team/regulars-app/GeGGsHPFfVnwoRitqt2SnqakB9SG), READY, `STRIPE ACCOUNT PASS`; the database rehearsal correctly skipped after its flag was disabled.
- Local validation: 167 tests passed, no failures/skips; syntax/JSON checked 53 JavaScript files. Both new `.mjs` files also passed explicit Node syntax checks.
- [CI run](https://github.com/SapceDandy/regulars_app/actions/runs/41366906916) completed successfully, including locked installation, syntax, 100% runtime coverage and PostgreSQL/PGlite application checks.
- Manual harness instructions: [README](../tests/manual/README.md).

## What this does not establish

The hosted test processes ran inside a build, not in separate public serverless
invocations. Square matching and delivery transports used synthetic inputs;
Stripe's account read was the only real provider request in this round. No SMS,
checkout, webhook, Wallet update or physical-device acceptance was exercised.
The restore snapshot stayed in process memory; retained off-site backups,
point-in-time recovery and a disaster-recovery runbook still need verification.

The next end-to-end flows need the Twilio auth token, Stripe/Square signing
secrets and reachable callbacks, reviewed venue/merchant settings, and Apple/
Google Wallet signing configuration. Authenticated HTTP cron, load/monitoring,
physical devices, accessibility and venue staff acceptance remain open. The
strict checklist therefore stays at 13/20 workstreams (65%); this round adds
partial evidence to payment identity and hosted operational resilience.
