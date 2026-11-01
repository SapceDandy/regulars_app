# Validation — October 30, 2026

## October 31 additional checks

- Syntax/JSON validation: passed, 30 JavaScript files.
- SQLite and PGlite: **60 passed each, 0 failed** after dialog error and checkout copy changes.
- Private locker, duplicate/early renewal, unpaid-hold release and party-size switching exercised in the hosted synthetic pilot.
- Provider account setup remains partial; no native pass or real provider transaction is claimed.

## October 31 follow-up

- `npm run check`: passed, 30 JavaScript files plus JSON.
- SQLite and PGlite suites: **60 passed each, 0 failed**.
- Hosted profile draft/save/reload/validation, FAQ, single-game booking and calendar download verified.
- 320px staff navigation verified without horizontal overflow; all task controls 48px high.
- Evidence and remaining gates are in the [pilot report](docs/PILOT_TEST_REPORT_2026-10-30.md).

## October 30 synthetic preview verification

- `npm run check`: passed.
- `npm test`: **57 passed, 0 failed**, SQLite.
- `npm run test:postgres`: **57 passed, 0 failed**, embedded PostgreSQL/PGlite.
- Hosted preview at code commit `da80f030c42482aed999049bb635b3a3b87f901e` completed persistent synthetic guest and manager workflows on Neon.
- Responsive Chromium frames checked at 320, 390 and 768 pixels; mobile header overlap corrected.
- Added tests for preview-only activation, blocked providers/real numbers, schema isolation, fixture roles and frame URL allowlisting.
- Details and limitations: [pilot report](docs/PILOT_TEST_REPORT_2026-10-30.md).

## Earlier live-provider readiness check (before synthetic mode)

- Runtime: Node.js 24.22.1.
- `npm run check`: passed, JavaScript syntax and JSON validation.
- `npm test`: **53 passed, 0 failed, 0 skipped**, SQLite.
- `npm run test:postgres`: **53 passed, 0 failed, 0 skipped**, embedded PostgreSQL (PGlite). The existing disk-based cross-process race test still uses SQLite; PGlite serializes its single connection. Hosted Neon multi-instance contention remains unverified.
- `npm audit --omit=dev`: **0 reported vulnerabilities** after updating ws to 8.22.0.
- Added coverage for async transaction rollback, competing allocations, concurrent job claiming and stale lease recovery, authenticated cron, invocation connection cleanup, safe startup failure, and Vercel IP trust.
- Vercel project and Neon integration created; separate session and cron secrets configured for preview and production.
- Protected preview deployment `dpl_Ae4Fef91A1JW1EYHV4bZDUAjwx1T` reached READY at commit `d5280c7d165ca101554258fd31392374205b4b7c`. Its `/healthz` returned HTTP 503 with the expected readiness message; provider credentials and approved venue configuration are missing.
- Hosted `/api/cron` returned `{"error":"Unauthorized"}` in the authenticated browser without a cron bearer token. The fetch connector classified its 401 as deployment authentication, so browser inspection confirmed the application response.
- At that earlier checkpoint, no Neon schema initialization or application transaction had run: configuration validation fails before opening the pool. A successful build is not a functioning hosted pilot.

## Prior baseline


- Runtime: Node.js 24.19.0; built-in SQLite 3.53.3.
- `npm run check`: passed; syntax checked for 22 JavaScript files, plus all JSON parsed.
- `npm test`: **46 passed, 0 failed, 0 skipped**.
- `bash -n scripts/publish-github.sh`: passed.
- Original product-reference copies were preserved from the prepared Regulars Brain.

Coverage includes simultaneous resource allocation in two workers, season-pass rollback, overlap checks, locked time-based prices, membership renewal/expiry, code/session/Origin protections, cross-venue access, service idempotency and stock bounds, signed Stripe fixtures, pending refunds, late-payment compensation, priority capacity and public-to-account queue flow, Wallet revision scheduling, independent delivery failures, Google JWT signatures and Apple package manifest/PKCS7 signatures.

Provider requests were mocked. Apple signing used a temporary self-signed certificate that was deleted after the test; no signing key or issued native pass is included in the repository. No live card charge, SMS, APNs delivery or Google Wallet object mutation was performed. The original baseline did not include browser QA. Current synthetic browser evidence is recorded above; full accessibility, actual device and issuer/payment tests remain open.

The code is a tested pilot foundation. The user-created remote application repository was located on October 16 at https://github.com/SapceDandy/regulars_app. Local test results do not establish live hosting, real venue setup, provider verification or production readiness.
