# Regulars

A lightweight guest and venue application for memberships, locker bottle records, Wallet passes, game-day reservations, season passes and an optional paid-priority walk-in lane.

This is the **application codebase** at [SapceDandy/regulars_app](https://github.com/SapceDandy/regulars_app), separate from the concept repository [Regulars Brain](https://github.com/SapceDandy/regulars_brain). It contains working local flows and implemented provider integrations that still require account configuration and live device/sandbox verification. It is not a claim that a venue has launched or that a live payment or pass has been issued.

## Run the local demo

Requires **Node.js 24.13+ within the 24.x line**. No third-party runtime packages, database server, build, or package installation are needed. OpenSSL is needed for live Apple pass signing and the signing test.

```sh
cp .env.example .env
npm start
```

Open `http://localhost:3000`. Demo mode binds only to localhost. Sample venues, proposed prices and game schedules are explicitly labeled. Text codes appear on screen, payments are simulated, and native Wallet buttons stay disabled. Never enter real patron details into the demo.

- Guest: use a synthetic phone number such as `+1 202-555-0101`.
- Manager: sign in using `+1 202-555-0100` and the displayed code.
- To test bottle service: buy a shared/private demo membership as the guest; sign out; sign in as manager; open **My Regulars → Your venue workspace → Lockers & bottles**; receive a bottle and tap **Serve 45 mL**. The member account reflects the saved change.
- To test check-in near kickoff, use the test suite or configure a test game with an appropriate window; the sample games begin in the future.

```sh
npm run check
npm test
```

## What is implemented

| Experience | Routes / behavior |
| --- | --- |
| Public discovery | Landing, venue search, partner inquiry, indexable live metadata/sitemap |
| Per-venue page | `/v/:slug`, membership choices, published games, capacity and booking terms |
| Phone account | SMS verification adapter, one-time codes, server-side sessions, preferences |
| Membership | Guest or paid fixed-term plan, shared/private locker allocation, manual renewal |
| Wallet | Signed Apple `.pkpass`, registration/update web service and APNs push; signed Google save JWT and object updates |
| Game bookings | Tables / bar seats, exact time windows, atomic season allocation, tiered deadline prices |
| At the door | Standard queue plus optional capped, escalating paid-priority lane |
| Staff | Current member lookup, bottle receipt/service/corrections, check-in, queue actions |
| Operator | Operating counts, campaign drafts/approval/copy links, sync/refund failures and retries |
| Resilience | Persistent SQLite, transactions, checkout holds, signature checks, idempotency, job retries |

See [implementation status](docs/IMPLEMENTATION_STATUS.md) for important limits. A generic iframe and staff API do **not** mean Square, Toast, OpenTable, Resy or another vendor is integrated.

## Why a monorepo

One code review, one test suite and one deployment keep a small pilot maintainable. The shared domain prevents reservations, Wallets and staff screens from drifting into different versions of membership state. The boundaries below leave room to split independent services after usage justifies it.

```text
apps/web/                 HTTP API and responsive guest/staff pages
packages/core/            membership, allocation, booking, service and queue rules
packages/db/              schema, transactions and seed configuration
packages/integrations/    Twilio, Stripe, Apple, Google, durable job delivery
tests/                   domain, concurrency, HTTP, signing and adapter checks
docs/                    product decisions, operations and implementation contracts
```

## Live setup and venue rollout

Follow [SETUP.md](docs/SETUP.md). Use a fresh live database, HTTPS, approved venue inventory/terms, Twilio Verify, Stripe, an Apple Pass Type ID certificate, and a Google Wallet issuer/class. A dedicated durable server/container runs the app and job loop. A separate .env and database isolate every environment.

The pilot uses **one Stripe merchant per deployment**. Independent venue settlement via Stripe Connect is not implemented. Do not use this as a multi-merchant marketplace until that work is complete. Configured location pages already share one template; see [venue configuration](docs/venues.example.json).

The venue operator receives partner inquiries in the database; this release does not send notification email. Campaigns are reviewed text and share links, not an autonomous outbound marketing system. Phone consent is collected separately from marketing preference.

## Repository updates

Use this existing application repository: `https://github.com/SapceDandy/regulars_app.git`. Keep business concept documents in `regulars_brain`. The repositories were public when selected for this upload; their existing visibility is preserved.

For future updates from a clone, [publish-github.sh](scripts/publish-github.sh) validates, commits and pushes to the existing application remote. It never creates another repository or force-pushes. Never put a token, live database or provider certificate in source control.

## Further reading

- [Product scope and decisions](docs/PRODUCT.md)
- [Architecture and invariants](docs/ARCHITECTURE.md)
- [Setup, deployment and new locations](docs/SETUP.md)
- [API contract](docs/API.md)
- [Staff, POS embedding and marketing workflow](docs/VENUE_OPERATIONS.md)
- [Implementation and verification status](docs/IMPLEMENTATION_STATUS.md)
- [Next iterations](docs/ROADMAP.md)
- [Official provider references](docs/REFERENCES.md)
