# Regulars pilot operations

## Operator access

Run these commands only in a trusted runtime with authorized direct access to the **Regulars** database. They are not HTTP endpoints. No customer or venue manager can grant themselves a role. Keep input files and output private; do not commit account identifiers, database URLs, notes or secrets.

Set `DATABASE_URL` using your secret manager, or explicitly set `DATABASE_PATH` to an existing SQLite database. Hosted production uses schema `public`; the isolated synthetic preview uses `REGULARS_DB_SCHEMA=regulars_pilot`. Never point this at Kudjo. Deploy the current application schema before running against PostgreSQL.

```sh
npm run operator -- report
npm run operator -- staff /private/regulars-staff-change.json
npm run operator -- review /private/regulars-payment-review.json
```

`report` returns unmatched/unreviewed payment reports, failed job IDs and staff role IDs. It omits customer phone numbers, card data, provider evidence and secrets. Check it daily and after webhook failures. Matched reports are in the venue's **Payment reviews** screen.

A staff change file has this shape; replace placeholders only in your private file:

```json
{"venueId":"VENUE_ID","userId":"EXISTING_VERIFIED_USER_ID","role":"staff","reason":"Operator-approved staff assignment"}
```

Roles are `staff`, `manager` or `none` (revoke). The user must already have signed in. Verify their identity with the venue owner before granting access. Changes invalidate all of that user's sessions and retain an audit record. Provision a replacement manager before demoting or removing the last manager. Staff invitations and stronger manager authentication remain separate work.

A payment review file has this shape:

```json
{"caseId":"VERIFIED_PROVIDER_EVENT_ID","reason":"Current provider status, reconciliation result, responsible owner and next step"}
```

Check the event/reference in the correct Stripe account before reviewing it. The command records an operator audit note; it does not assign an unknown charge to an order, issue a refund, submit dispute evidence, erase payment history or alter benefits. An unmatched event that later gains a verified payment binding becomes visible to the appropriate venue manager. If a mismatch returns 404/409, inspect both the durable report and Stripe's retries; review alone does not fix the rejected settlement. Never edit amounts or entitlement rows manually to force a match.

## Stripe disputes and reconciliation

Use a **separate Regulars sandbox**. Subscribe the signed snapshot webhook to the Checkout/refund events in SETUP.md and all five `charge.dispute.*` event types listed there. Each verified dispute event creates a report with a provider reference, amount/currency, reported status and response deadline when provided. Duplicate event IDs create one report. Disputed amounts can differ from the original charge.

Reports intentionally form an append-only inbox: event delivery can be out of order, so the app does not assume the latest delivery is the current Stripe status. A new report creates a new review task. Verify the current status in Stripe. Handle evidence, acceptance, appeals and refunds there; reviewing a report inside Regulars is not a dispute response. Agree any service decision with the guest and venue. No automatic cancellation or extra charge is introduced.

The dashboard's collected value subtracts recorded refunds from paid Regulars orders. It excludes Stripe fees, disputes, payouts and Square sales. Reconcile those in the provider dashboard. An operator must own time-sensitive dispute follow-up; outbound alert delivery is not implemented.

## Square service inbox

The first adapter is for **one configured merchant and location**, with explicit staff matching. Stripe continues to process Regulars memberships, tickets and priority access. Square takes the venue's own point-of-sale payments. Regulars does not create Square payments, refund Square purchases, import its catalog or automatically infer bottle quantities from a receipt.

In a separate Regulars Square sandbox application, subscribe to `payment.created` and `payment.updated`. Set the exact public HTTPS notification URL to `/api/webhooks/square`, then configure these only in the isolated provider-testing environment:

| Variable | Value |
| --- | --- |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | That subscription's signing secret |
| `SQUARE_WEBHOOK_URL` | Exact notification URL registered with Square |
| `SQUARE_MERCHANT_ID` | Regulars pilot sandbox merchant |
| `SQUARE_LOCATION_ID` | The selected sandbox location |
| `SQUARE_VENUE_ID` | Corresponding approved Regulars venue ID |

The receiving service verifies HMAC over the configured URL and untouched request body, then verifies merchant, location, payment identity, USD amounts and creation time. No outbound Square token is needed for this receiving adapter. Incomplete configuration returns 503. Synthetic and demo modes reject Square ingress.

Completed payments appear under **Square service**. Staff confirm the guest, active locker membership, physical service, selected bottle and mL. One payment supports one bottle entry; combine portions from that bottle into one amount. For food/other sales or service already entered under Lockers & bottles, choose **No bottle entry needed** and leave a note. Multiple bottles per payment need a future line-item workflow; do not duplicate a payment to work around this limit.

The same payment ID cannot create two inbox entries. The same resolved payment cannot debit twice, including concurrent requests. A failed stock/authorization check leaves it open. Cumulative refund amounts never decrease on reordered updates; refunds do not restore physical liquid or repeat a service entry. Staff must verify actual service before recording a refunded receipt.

## Provider-testing handoff

The current protected preview stays synthetic and blocks providers. Use a separate non-synthetic test environment and fresh database with approved test inventory, the exact Regulars merchant mapping, and a provider-accessible webhook endpoint. Decide endpoint protection deliberately; do not disable the existing preview's authentication to make a provider reach it.

Once configured, rehearse:

1. Stripe success, decline, abandoned checkout, duplicate/late delivery, cancellation, partial/full refund, dispute report and manager/operator review.
2. Square completed sale, unrelated merchant/location rejection, duplicated and reordered events, explicit service, insufficient stock, refunded sale, no-service sale and second-staff retry.
3. Guest versus staff versus manager permissions; revoked staff cannot reuse their session; operator provisioning preserves the last manager.
4. Actual iPhone/Android pass installation, stock refresh, membership expiry and refund behavior; SMS sign-in and failed delivery on controlled phones.
5. Hosted database contention, authenticated job processing, backup restore, monitoring and a venue rehearsal.

Real provider traffic, native-device checks and hosted operational rehearsal remain release gates. Automated tests and 100% measured code coverage do not establish those outcomes.
