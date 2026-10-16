# Setup and rollout

## 1. Local functional review

Use Node 24.13+ in the 24.x line. Start with `cp .env.example .env` and `npm start`. No dependency install is required. Open `http://localhost:3000`. The `data/` database is created on first start. All seed records are synthetic; keep demo data separate from live data.

Run `npm run check` and `npm test`. The suite uses temporary databases, local HTTP servers, mocked provider requests and a temporary self-signed certificate. It never charges cards, sends SMS or uploads a pass to a real issuer.

## 2. Approve one live venue

Copy `venues.example.json` to a private runtime location outside the repository. Replace every illustrative value with reviewed venue details. Configure exact benefits, fixed-term price, locker modes/positions, actual tables and bar seats, contacts, policies, staff phone numbers and published game times. `startsAt` / `endsAt` are UTC milliseconds; the page formats them using the venue's IANA timezone.

Set `approved: true` only after the venue approves these details. This is an operator acknowledgment, not a substitute for an agreement or physical installation signoff. Set `demo: false`. The server never considers software inventory proof that cabinetry or storage procedures are ready.

Create `.env` outside the tracked source in deployment and set:

```text
APP_MODE=live
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
PUBLIC_ORIGIN=https://your-real-regulars-domain
DATABASE_PATH=/data/regulars.sqlite
VENUE_CONFIG_PATH=/run/regulars/venues.json
SESSION_SECRET=<new random 32+ character secret>
```

Use a **fresh database**. Startup rejects a live database containing demo venues. The example plans are manual-renewal fixed terms. Automatic subscription billing is not enabled by changing a label.

## 3. SMS sign-in

Configure a Twilio account and Verify service; set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID`. Configure the provider's supported regions and abuse limits for the intended pilot. Verify receipt, incorrect/expired codes, resend cooldown and returning-user login with actual test devices. The app never returns a live code in its API.

The marketing checkbox is a stored preference only. No promotional messages are sent in this release. A future sender must honor permissions, STOP/opt-out events, approved templates and delivery logs.

## 4. Payments

Use Stripe sandbox/test credentials first. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Register the HTTPS endpoint:

```text
https://your-real-regulars-domain/api/webhooks/stripe
```

Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `charge.refunded`. Checkout is restricted to immediate card payments in this release; the async success handler is present for explicit future extension. Only a paid, amount/currency/session-matching event activates an order.

Test card success/decline, interrupted checkout and resume, duplicate webhooks, capacity conflicts, cancelled holds, refund pending/failure, and late webhook compensation. Compare app orders to the processor dashboard before changing to live keys. One deployment uses one merchant account. Independent-merchant routing, transfers, payouts, platform fees and settlement are future Stripe Connect work.

## 5. Apple Wallet

Create the Apple Pass Type ID, pass-signing certificate and associated private key. Obtain Apple's current WWDR intermediate matching the certificate chain. Mount the PEM files read-only outside the repository; configure `APPLE_PASS_TYPE_ID`, `APPLE_TEAM_ID`, `APPLE_CERT_PATH`, `APPLE_KEY_PATH`, and `APPLE_WWDR_PATH`. The private key must be usable non-interactively by OpenSSL; protect the mount and host.

The account endpoint emits a signed `.pkpass`. The `webServiceURL` points to `/api/wallet/apple`, with device registration, unregister, changed-serial-number and updated-pass endpoints underneath `/v1/`. APNs uses the pass certificate to signal a refresh with an empty JSON body. Database revisions remain the source of truth. Routine stock changes do not include an interruptive pass change message.

On a real iPhone: add a pass, confirm device registration, record a pour, run the job loop, confirm APNs delivery and the new displayed balance, verify expiration, remove/re-add the pass, and verify registration removal. The local signing test proves package/signature structure with a self-signed fixture; it does not prove Apple trust or real delivery. Replace basic text buttons with final approved Wallet button artwork before customer release.

## 6. Google Wallet

Provision a Google Wallet issuer, service account permissions and a Generic pass class. Set `GOOGLE_ISSUER_ID`, the fully qualified `GOOGLE_CLASS_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and a mounted `GOOGLE_PRIVATE_KEY_PATH`. The class must exist; this release does not create the class or configure issuer approval.

The service signs the Save to Google Wallet JWT and updates the member's Generic object through the Wallet Objects API. On an actual Android account: save, record service, verify new stock and status, test expired membership, and verify provider error/retry behavior. Issuer publishing/approval status and service-account permissions must support the intended users.

Both Wallet configurations are expected for live sync. Missing configuration keeps delivery observable in the failed/pending job view rather than faking a pass.

## 7. Host the application

Use one Node process with a durable local disk and TLS reverse proxy. Set a private runtime environment file and mount certificates and venue config. Never put the SQLite database in a source repository, in a public asset directory or on ephemeral hosting.

Set `TRUSTED_PROXY_IPS` to the exact private source IP(s) used by the TLS proxy, including an IPv4-mapped IPv6 form when applicable. The proxy must append or overwrite `X-Forwarded-For` with the actual client address. Untrusted peers cannot supply their own rate-limit identity. Without this setting, requests share the proxy's sign-in rate bucket. Keep the Node port reachable only by that proxy in live hosting.

The Dockerfile uses the non-root `node` user. Provision `/data` writable by UID 1000 and mount it persistently. Mount private configuration under `/run/regulars`. The operator supplies TLS and runtime environment. `/healthz` verifies that the process answers requests; it does not verify SMS, Stripe or Wallet readiness.

`npm start` runs the HTTP server and a single background loop. Do not scale worker replicas without adding database job leases. Native Sites/Workers hosting is not configured: this project intentionally targets a normal durable Node deployment and the user's separate GitHub repository.

## 8. Operations and changes

- `npm run backup` uses SQLite's online backup API into ignored `backups/`. Put encrypted backups on independent durable storage and rehearse restoration before launch.
- `npm run seed` initializes missing venues and **preserves existing configuration**. It will not silently rewrite active venue records, resources, prices or booked games.
- New location: add another complete venue block with a unique ID/slug to private config, run initialization, then review `/v/<slug>` and role isolation. Use only locations under the configured merchant until multi-merchant settlement exists.
- Existing-venue changes need an explicit migration/admin workflow. Do not edit booked game times or physical allocation modes directly without checking current orders and informing affected guests.
- Staff access comes from approved config on first initialization. Changes to existing staff require an explicit operator migration; an invitation/admin screen is a roadmap item.
- Partner inquiries are stored in `leads`. They are not emailed. The trusted operator can review them through a private database/admin workflow.
- Review the venue **Sync status** tab, membership expiration, refunds and service discrepancies daily. Run a physical-stock reconciliation with staff during the pilot.

## Release rehearsal

Before enrolling real customers, complete the guest/venue journeys in PRODUCT.md, actual provider/device checks above, responsive browser QA, staff rehearsal, backup restoration, and a documented support path. Supply a reviewed privacy/contact/retention policy and venue agreement matching the software behavior. The bundled privacy page is a factual starting point, not completed operator documentation.
