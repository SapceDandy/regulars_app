# Provider references checked during implementation

These are primary technical references, checked October 15, 2026. Provider setup and approval details still need a current check when configuring live accounts.

- [Node SQLite API](https://nodejs.org/api/sqlite.html) — built-in API; the code was run with Node 24.19.0 and isolates the adapter for future API changes.
- [Apple: adding a web service to update passes](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes).
- [Apple Wallet Developer Guide: updating a pass](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Updating.html) — registration, empty notification body, changed serials, authentication and stable tokens.
- [Google Wallet: web issuance](https://developers.google.com/wallet/generic/web).
- [Google Wallet: save JWTs](https://developers.google.com/wallet/generic/use-cases/jwt).
- [Google Wallet: Generic object PATCH](https://developers.google.com/wallet/reference/rest/v1/genericobject/patch).
- [Twilio Verify: verifications](https://www.twilio.com/docs/verify/api/verification).
- [Twilio Verify: verification check](https://www.twilio.com/docs/verify/api/verification-check).
- [Stripe: fulfill Checkout orders](https://docs.stripe.com/checkout/fulfillment).
- [Stripe: webhooks](https://docs.stripe.com/webhooks).
- [Stripe: idempotent requests](https://docs.stripe.com/api/idempotent_requests).
- [Stripe: refund states](https://docs.stripe.com/api/refunds/object).

The implementation deliberately avoids pretending these references establish that the user's actual provider accounts, certificates, issuers or devices are configured.
