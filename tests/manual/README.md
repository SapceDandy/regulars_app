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
