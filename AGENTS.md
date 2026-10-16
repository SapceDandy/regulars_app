# Regulars engineering

Read README.md, docs/PRODUCT.md, docs/ARCHITECTURE.md and docs/IMPLEMENTATION_STATUS.md before changes. The separate Regulars Brain remains the strategic reference. The owner's October 15, 2026 codebase request expands the prior MVP to game-day ticketing, season passes, time-based prices and a bounded paid-priority queue. Do not silently drop these features or treat older drafts as newer decisions.

Use a single monorepo. Keep rules in packages/core, persistence in packages/db, external services in packages/integrations, and HTTP/browser code in apps/web. Domain writes must remain transactional; never await network operations inside a SQLite transaction. Use the outbox after committing service records. This deployment has one application/worker process and durable local SQLite, not serverless ephemeral storage.

Never grant a paid entitlement from a success redirect, phone number alone, a static pass screenshot or an unverified provider payload. Payment amounts come from held server inventory. Only signature-verified, matching paid webhooks settle live orders. Keep holds, attendance, cancellations and refunds distinct. Preserve webhook and service idempotency. Whole/shared physical allocation modes, seating capacity and membership capacity are separate.

Access must be checked against the actual record's venue. Staff roles are provisioned by the operator, never from a client payload. Every stock adjustment retains actor, time, delta and reason. Positive stock corrections need a manager. Pass codes identify records; they are not public bearer authorization to read member details or serve alcohol.

Demo mode is local only, uses synthetic records, displays development codes and simulates payments. Production refuses demo mode. Never commit phone data, databases, provider keys, certificates or real transaction payloads. Do not introduce live claims, real partner venues, fabricated testimonials, automatic drinks rewards, wagering or unapproved messaging.

Fixed membership terms, manual renewal, illustrative prices, price tiers, priority capacity and seed inventory are implementation defaults for review. They are not validated commercial commitments. Venue staff handle physical service, ID checks and exceptions.

Run npm run check and npm test after meaningful code changes. Add focused regressions for inventory races, access, payment and stock behavior. Use real sandbox/device evidence before marking external integrations verified. Browser visual QA was unavailable in the creation environment; do not imply it was completed. Record changed implementation status in docs/IMPLEMENTATION_STATUS.md.
