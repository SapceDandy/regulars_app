# Architecture

The pilot is one Node.js 24 process, one durable SQLite database in WAL mode, and a small same-origin web client. There is no transpiler, frontend framework, separate queue service or required model API. Node's built-in SQLite API is isolated behind `packages/db/store.js` so persistence can change later.

## Boundaries

| Boundary | Responsibility |
| --- | --- |
| apps/web | Session-aware HTTP routes, same-origin writes, allowlisted assets, public metadata, browser views |
| packages/core | Business invariants and atomic changes; no provider requests |
| packages/db | Prepared SQL, schema v1, `BEGIN IMMEDIATE` transactions, reproducible venue initialization |
| packages/integrations | Twilio verification, Stripe checkout/webhooks/refunds, native passes and delivery retries |

## Critical invariants

- An order holds an immutable amount, currency, benefit/terms snapshot and inventory. The browser cannot set its price.
- Only a matching paid event, verified with the Stripe webhook signing secret, activates live entitlements. Return-page navigation does nothing to payment state.
- Transactions lock the allocation decision and writes together. Two processes competing for a table have one winner. Overlap checks use actual time intervals rather than only event IDs.
- A season pass commits all games or rolls back all of them. Resource capacity and party size are enforced; future added games are not part of an old purchase.
- Lockers have one configured physical mode. Shared positions and whole lockers cannot be sold as different modes of the same locker. Renewals extend their existing position without moving it.
- A guest pass cannot authorize stored bottles. Pass codes are opaque record identifiers; protected staff lookup checks current status and venue.
- Bottle changes record identity, time, reason, signed delta and retry key. They cannot exceed capacity or fall below zero. Only managers can add a positive correction.
- A stock write commits before external Wallet delivery. A provider outage leaves service recorded and creates an observable retry, not a lost pour.
- Expired memberships revoke current access and release allocation. Wallet revisions increase globally, including refreshes when the next game ends.
- Paid priority does not consume reservation inventory or alter a confirmed booking. It is an explicit venue queue workflow, disabled unless configured.

## Sessions and abuse controls

Twilio Verify owns live code generation and checking. The app maintains a short-lived challenge and attempt count; the demo uses a random HMAC-protected code only on localhost. Sign-in sessions are high-entropy random tokens stored as hashes in SQLite, with HttpOnly, SameSite cookies and Secure cookies for live HTTPS. Writes require the configured Origin and JSON. No permissive CORS is enabled. Rate counters persist across restarts.

Staff privileges are operator-provisioned per venue. User IDs, staff roles and prices cannot be asserted by clients. Staff access is checked against each mutated record. Authentication by phone has the ordinary phone-number recycling/SIM-recovery limitation; a more complete account-recovery process and stronger manager authentication remain release hardening work.

## Delivery and recovery

The job loop checks a durable outbox every fifteen seconds. Failed operations back off and eventually enter a failed state with a manager retry action. Stripe operations use stable provider idempotency keys. Wallet pushes are best-effort signals to refresh; the account and staff views always read the database. The release runs only **one worker loop**; multiple workers need leases/claiming before being enabled.

Late payment after hold release queues a refund instead of allocating someone else's table. Cancellations and refunds are distinct states. Refunds still pending at Stripe stay pending locally until success or a full-refund webhook. Partial or externally adjusted refunds need operator reconciliation.

## Deployment and scaling

Use persistent local block storage with one writable app process. Do not put the SQLite database on a network filesystem or ephemeral serverless disk. Back up through SQLite's backup API, not by copying only the main file while WAL is active.

Growth sequence: add actual provider/device telemetry and reconciliation; add transactional schema migrations before changing a deployed schema; replace the store with PostgreSQL when write load or deployment topology justifies it; add worker leases; use Stripe Connect and tenant secrets for independent venue commerce. Extract a service only where a separate scaling or ownership need appears.
