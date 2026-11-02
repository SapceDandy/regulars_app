# Architecture

The application uses Node.js 24 and a same-origin web client. Local development uses durable SQLite in WAL mode; Vercel uses PostgreSQL: the provider-testing branch selects Supabase, while the existing synthetic preview stays on Neon. Supabase uses a restricted server database role, a private `regulars` schema and verified TLS through its transaction pooler. App sessions remain Twilio-based; Supabase Auth and public Data API access are not used. Both expose the same asynchronous store contract. Each hosted invocation owns and closes its pool. Initial schema creation runs under the database advisory lock once per warm function instance; it is idempotent, not a general migration framework.

## Boundaries

| Boundary | Responsibility |
| --- | --- |
| apps/web | Session-aware HTTP routes, same-origin writes, allowlisted assets, public metadata, browser views |
| packages/core | Business invariants and atomic changes; no provider requests |
| packages/db | Parameterized SQL, SQLite / PostgreSQL schemas, serialized transactions, reproducible venue initialization |
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

Twilio Verify owns live code generation and checking. The app maintains a short-lived challenge and attempt count; the demo uses a random HMAC-protected code only on localhost. Sign-in sessions are high-entropy random tokens stored as hashes in the database, with HttpOnly, SameSite cookies and Secure cookies for live HTTPS. Writes require the configured Origin and JSON. No permissive CORS is enabled. Rate counters persist across restarts.

Staff privileges are operator-provisioned per venue. User IDs, staff roles and prices cannot be asserted by clients. Staff access is checked against each mutated record. Authentication by phone has the ordinary phone-number recycling/SIM-recovery limitation; a more complete account-recovery process and stronger manager authentication remain release hardening work.

## Delivery and recovery

The local job loop checks a durable outbox every fifteen seconds. Failed operations back off and eventually enter a failed state with a manager retry action. Stripe operations use stable provider idempotency keys. Wallet pushes are best-effort signals to refresh; the account and staff views always read the database. Local execution uses one timer. Vercel Cron invokes `/api/cron` every minute in production with CRON_SECRET. Each job is claimed with a five-minute lease inside a transaction; a token fences completion by stale workers. While that lease is active, workers skip other jobs for the same delivery kind and subject. This prevents an overlapping older Wallet snapshot from finishing after a newer snapshot, while other members and delivery kinds can proceed. Expired leases allow recovery. Delivery remains at least once, so provider idempotency is still necessary; the lease does not fence an external provider after expiry. Preview jobs require an authenticated manual invocation; Vercel does not schedule preview cron.

Late payment after hold release queues a refund instead of allocating someone else's table. Cancellations and refunds are distinct states. Refunds still pending at Stripe stay pending locally until success or a full-refund webhook. Partial or externally adjusted refunds need operator reconciliation.

## Deployment and scaling

For SQLite hosting, use persistent local block storage with one writable app process. Vercel requires DATABASE_URL and uses PostgreSQL. Do not put the SQLite database on a network filesystem or ephemeral serverless disk. Back up through SQLite's backup API, not by copying only the main file while WAL is active.

PostgreSQL transactions take one application-wide advisory lock, preserving inventory serialization across instances at the cost of write throughput. This is a pilot tradeoff, not a high-throughput architecture. The embedded PostgreSQL harness serializes its single connection and cannot prove multi-instance hosted contention.

Growth sequence: add actual provider/device telemetry and reconciliation; add versioned transactional schema migrations before altering existing tables; load-test and narrow the PostgreSQL advisory lock as needed; use Stripe Connect and tenant secrets for independent venue commerce. Extract a service only where a separate scaling or ownership need appears.
