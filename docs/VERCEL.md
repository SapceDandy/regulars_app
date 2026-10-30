# Vercel pilot setup

Project: `regulars-app` in `sapcedandy-s-team`; Node.js 24.x. Connect the Neon integration for preview and production with separate preview branches. Keep Vercel Authentication enabled during pilot preparation. Never copy production customer data into a preview branch.

## Required configuration

Set values in Vercel Project → Settings → Environment Variables, separately for preview and production. Never paste credentials into issues, PRs, or chat.

| Variable | Source / purpose |
| --- | --- |
| DATABASE_URL | Neon integration, already connected |
| SESSION_SECRET | Random 32+ character secret, stable within each environment |
| CRON_SECRET | Random secret used by Vercel to authorize `/api/cron` |
| PUBLIC_ORIGIN | Exact HTTPS URL used by guests; preview can default to VERCEL_URL |
| TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_SID | Operator's Twilio Verify service; pilot recipients must be controlled test numbers |
| STRIPE_SECRET_KEY | Stripe sandbox `sk_test_` key for preview; separate production key only after pilot verification |
| STRIPE_WEBHOOK_SECRET | Signing secret for that environment's `/api/webhooks/stripe` endpoint |
| VENUE_CONFIG_JSON | Reviewed venue configuration using the schema in docs/SETUP.md; explicit approved flag, real inventory, terms, prices and staff |

The Vercel adapter always uses production security rules, including genuine phone verification and signature-verified payments. It never enables localhost demo codes on a hosted URL. Missing required configuration returns 503. No approved venue or provider key is supplied by the code.

The Neon integration secrets are sensitive and need not be exported. PostgreSQL schema creation is idempotent and serialized; the adapter migrates once per warm function instance and seeds only absent venues. Existing records are not overwritten by config edits. There is no automatic import from a demo SQLite database.

## Verification before pilot access

1. Run `npm ci`, `npm run check`, `npm test`, and `npm run test:postgres`. The PostgreSQL test engine is PGlite; this is not hosted Neon load-test evidence.
2. Deploy the branch as a protected preview. Confirm `/healthz`, homepage, venue page, assets and staff authorization. Confirm missing configuration fails closed and unauthorized `/api/cron` returns 401.
3. Configure the sandbox Stripe webhook. Vercel Authentication blocks third-party webhooks unless explicitly allowed through a protected webhook access mechanism; configure that deliberately before testing. Keep any bypass token secret. Verify raw-byte signature validation, duplicate delivery and mismatched amount rejection on the hosted function.
4. Use controlled pilot phone numbers to verify sign-in, expiry, sign-out and rate limits. Test guest enrollment, sandbox checkout, account activation, cancellation and refund. Verify two separate hosted clients competing for the last seat have exactly one winner.
5. Rehearse staff role isolation, check-in, bottle receipt/service/correction, priority capacity and order retries. Invoke preview cron manually with the secret; verify leases and recovery after a killed worker. The production cron runs every minute; allow the extra scheduling delay when checking expiry.
6. Configure Wallet issuer credentials separately and test actual iOS/Android installation and refresh. Apple signing requires OpenSSL and mounted credentials; compatibility and delivery on Vercel remain unverified. Do not advertise native Wallet readiness until tested.
7. Verify Neon restore/recovery, monitoring, provider reconciliation and venue staff acceptance before promoting. Deployment success alone is not pilot completion.

## Operational limits

Transactions use one PostgreSQL advisory lock to preserve the original inventory allocation guarantees. This bounds throughput and requires hosted load testing before broader rollout. Providers are called outside database transactions. Jobs use five-minute leases and token-fenced completion with at-least-once delivery; Stripe idempotency prevents duplicate refund effects.

Vercel Cron runs only on production deployments, not previews. The configured per-minute schedule requires a supporting plan. Protect CRON_SECRET and inspect failed jobs through the manager interface. The frontend and webhook routes share one Node function with automatic body parsing disabled.

Local `scripts/backup.js` is SQLite-only. Use Neon's managed backup/restore capabilities for hosted data and verify retention for the selected plan. Production rollback must use a deployment compatible with the current schema; no destructive schema migration is included here.
