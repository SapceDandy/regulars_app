# Regulars provider pilot environment

The `codex/provider-pilot` branch prepares a separate Vercel Preview for real provider sandbox tests. It starts from the tested application revision `1ab92266ac09e72dec2924c61ed0cc648168fc1e`. The initial branch change is documentation only.

## Isolation and current state

- Keep the existing `codex/vercel-postgres-pilot` synthetic preview working independently.
- Provider-pilot configuration is scoped to this branch. It uses the separate Regulars Stripe sandbox and Square sandbox application, never KUDJO live credentials.
- `PILOT_TESTING_ENABLED=false` selects real authentication and signed-provider handling. Missing prerequisites must return an unavailable response; do not use placeholder credentials or synthetic authentication to start it.
- Session and cron secrets are distinct from other environments. Store all credentials as server-only Vercel secrets.
- Neon automatic preview branching is enabled in the storage connection. Confirm the actual provider branch and its contents before initializing data or running recovery tests. Project-level environment labels do not identify the deployment-time Neon branch.
- Retain Vercel Authentication. Approve an exact webhook access mechanism before registering external callbacks; do not expose account or staff routes.

## Remaining configuration

| Provider | Required next step |
| --- | --- |
| Stripe | Register the exact branch-stable HTTPS `/api/webhooks/stripe` endpoint with the snapshot events listed in SETUP.md; install its own signing secret; verify delivery. |
| Square | Register `/api/webhooks/square` for `payment.created` and `payment.updated`; install its signing secret and exact URL; map the sandbox merchant/location to the approved test venue. |
| Twilio | Create a Regulars-specific Verify service and configure its account SID, auth token and service SID through secret storage. |
| Apple Wallet | Complete developer membership and provision the Regulars Pass Type ID, trusted pass certificate, private key and matching WWDR intermediate. |
| Google Wallet | Authorize a service account for the existing issuer, enable the Wallet API, create the Generic class and configure server-only signing material. |
| Venue | Supply explicitly reviewed test inventory, terms, prices and controlled staff identities through private `VENUE_CONFIG_JSON`. Do not mark illustrative venue data approved as a substitute for review. |

Follow docs/VERCEL.md, docs/SETUP.md and OPERATIONS.md. A successful build or populated environment variable is not evidence of a working provider integration. Close each gate with actual signed callback, controlled-phone or physical-device results as applicable.
