# Validation — October 30, 2026

- Runtime: Node.js 24.22.1.
- `npm run check`: passed, JavaScript syntax and JSON validation.
- `npm test`: **53 passed, 0 failed, 0 skipped**, SQLite.
- `npm run test:postgres`: **53 passed, 0 failed, 0 skipped**, embedded PostgreSQL (PGlite). The existing disk-based cross-process race test still uses SQLite; PGlite serializes its single connection. Hosted Neon multi-instance contention remains unverified.
- `npm audit --omit=dev`: **0 reported vulnerabilities** after updating ws to 8.22.0.
- Added coverage for async transaction rollback, competing allocations, concurrent job claiming and stale lease recovery, authenticated cron, invocation connection cleanup, safe startup failure, and Vercel IP trust.
- Vercel project and Neon integration created; provider credentials and approved venue configuration are still needed. This evidence does not establish a functioning hosted pilot.

## Prior baseline


- Runtime: Node.js 24.19.0; built-in SQLite 3.53.3.
- `npm run check`: passed; syntax checked for 22 JavaScript files, plus all JSON parsed.
- `npm test`: **46 passed, 0 failed, 0 skipped**.
- `bash -n scripts/publish-github.sh`: passed.
- Original product-reference copies were preserved from the prepared Regulars Brain.

Coverage includes simultaneous resource allocation in two workers, season-pass rollback, overlap checks, locked time-based prices, membership renewal/expiry, code/session/Origin protections, cross-venue access, service idempotency and stock bounds, signed Stripe fixtures, pending refunds, late-payment compensation, priority capacity and public-to-account queue flow, Wallet revision scheduling, independent delivery failures, Google JWT signatures and Apple package manifest/PKCS7 signatures.

Provider requests were mocked. Apple signing used a temporary self-signed certificate that was deleted after the test; no signing key or issued native pass is included in the repository. No live card charge, SMS, APNs delivery or Google Wallet object mutation was performed. Browser visual/accessibility/device QA and actual issuer/payment tests remain open.

The code is a tested pilot foundation. The user-created remote application repository was located on October 16 at https://github.com/SapceDandy/regulars_app. Local test results do not establish live hosting, real venue setup, provider verification or production readiness.
