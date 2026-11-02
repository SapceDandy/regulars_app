# Stripe sandbox rehearsal

This is an opt-in manual integration test. It creates actual Stripe **sandbox**
Checkout sessions and refunds, using the application's HTTP routes and payment
adapter with a fresh in-memory SQLite database. It is not a CI test, a deployed
mode, or evidence of hosted Vercel webhook delivery.

Use Node 24+, dependencies installed with `npm ci`, and the official Stripe CLI.
Save the authorized sandbox secret in a temporary file outside the repository,
readable only by its owner (`chmod 600`). Never paste the key into command-line
arguments, source, screenshots or the transcript. Supply the expected sandbox
account explicitly so a key for another project cannot be used accidentally.

```sh
node --use-env-proxy tests/manual/stripe-sandbox.mjs /path/to/protected-key-file acct_EXPECTED /path/to/stripe
```

The harness rejects live keys and existing database settings, verifies the Stripe
account, and starts a localhost-only application and a CLI webhook listener. It
uses fake customer/manager identities; SMS and Wallet sends remain unconfigured.
The temporary CLI signing secret stays in memory and must not be installed as a
hosted webhook secret. A `ready` JSON line indicates the listener is active.

Send one JSON command per line:

```json
{"action":"create","name":"member","kind":"membership"}
{"action":"status"}
{"action":"replay","name":"member"}
{"action":"partial","name":"member","cents":1000}
{"action":"review","name":"member"}
{"action":"create","name":"booking","kind":"ticket","resource":0}
{"action":"cancel","name":"booking"}
{"action":"create","name":"expired","kind":"ticket","resource":1}
{"action":"expire","name":"expired"}
{"action":"stop"}
```

Open each returned Checkout URL in a browser and use Stripe's documented test
cards. Check status after every webhook. `replay` must run within the signature
tolerance after a completed payment: it checks duplicate suppression and rejects
a tampered payload. `partial` accepts the desired refund amount in cents; use the
remaining amount to complete a membership refund. `review` checks both customer
denial and manager authorization. Membership self-cancellation is intentionally
not supported; paid booking cancellation invokes the real refund worker.

Before stopping, fully refund successful payments and expire unused sessions.
Stopping closes local resources; it does **not** refund or expire provider objects
automatically. Record terminal states without saving raw events. Delete the
temporary key file and clear any credential clipboard afterward. If interrupted,
finish cleanup in the matching sandbox dashboard using the printed identifiers.

The return URL points to this machine's localhost server. A remote cloud browser
cannot verify that return page. Verify hosted return URLs and public signed
webhook delivery separately before enabling a business pilot.

References: [Stripe test cards](https://docs.stripe.com/testing),
[Stripe CLI](https://docs.stripe.com/cli), and
[webhook testing](https://docs.stripe.com/webhooks/quickstart).

# Hosted PostgreSQL contention and recovery rehearsal

`node tests/manual/hosted-postgres.mjs` is skipped unless `REGULARS_HOSTED_REHEARSAL`
is explicitly set to the expected Supabase project ref. It also requires Vercel
Preview, the `codex/provider-pilot` branch, Supabase selection, the expected
`regulars_runtime.<project-ref>` pooler user and verified TLS. Never enable it
on production or on a KUDJO database.

An administrator must first provision the existing PostgreSQL schema in a
separate `regulars_pilot` schema owned by `regulars_runtime`, enable RLS on all
29 tables, and deny schema access to PUBLIC, anon and authenticated. This is
separate from both the provider `regulars` schema and the older Neon synthetic
preview. The harness refuses nonempty fixture tables; its transactionally
inserted ownership marker prevents overlapping rehearsals.

Independent Node child processes each open their own PostgreSQL pool. The checks
cover booking contention, checkout replay, bottle retry/overdraw, synthetic
Square matching, rollback, the last manager, leased jobs, stale-lease recovery,
delivery outage/retry, logical snapshot restoration and unchanged provider-schema
counts. Only reserved fictional phone numbers are inserted. No external payment,
SMS or Wallet client is created. All fixture rows are removed after the run;
metadata rows return to their initial values. If a process is forcibly killed,
inspect the leftover fixtures before attempting cleanup or another run.

Logs contain pass/fail labels, not credentials, rows or raw provider events.
The logical snapshot stays in process memory: this is **not** proof of off-site
backup retention, point-in-time recovery, public Vercel HTTP behavior, scheduled
cron, real provider delivery or device acceptance. Disable the rehearsal flag
after collecting its evidence.

## Hosted Stripe sandbox identity

`node tests/manual/hosted-stripe-account.mjs` is skipped unless
`REGULARS_STRIPE_ACCOUNT_CHECK` equals the approved Regulars sandbox account ID.
It requires Vercel Preview, `codex/provider-pilot`, and a test secret already
stored in Vercel. The key is used only in memory for `GET /v1/account` at Stripe's
fixed API origin, without a connected-account header or redirects. Only a
matching account ID passes; logs omit account details, response bodies and keys.
No customer, payment or webhook is created. Disable the flag afterward. This
checks account isolation and authentication, not Checkout or webhook delivery.
