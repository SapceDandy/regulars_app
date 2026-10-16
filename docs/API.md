# API contract

All browser requests use the configured origin. JSON writes require `Origin: <PUBLIC_ORIGIN>` and `Content-Type: application/json`. Authentication uses the HttpOnly `regulars_session` cookie. Errors use `{ "error": "message", "requestId": "opaque-id" }` and an appropriate 4xx/5xx status. No permissive CORS is enabled.

## Guest and public API

| Method / path | Purpose | Access |
| --- | --- | --- |
| GET `/api/config` | Demo/live mode and non-secret Wallet readiness | Public |
| GET `/api/venues` | Venue directory | Public |
| GET `/api/venues/:slug-or-id` | Venue, plans, games, resources, live capacity, priority quote | Public |
| POST `/api/auth/start` | `{phone,smsConsent:true}` | Public, rate limited |
| POST `/api/auth/verify` | `{phone,code,name?,marketingOptIn?}` | Valid one-time challenge |
| POST `/api/auth/logout` | Invalidate session | Session |
| GET / PATCH `/api/account` | Own records / `{name,marketingOptIn}` | Session |
| POST `/api/memberships/guest` | `{venueId,planId}` | Session |
| POST `/api/orders` | Hold capacity and create Checkout; header `Idempotency-Key` | Session |
| GET `/api/orders/:id` | Own order, locked amount and terms | Owner |
| POST `/api/orders/:id/resume` | Resume/recover the same unexpired checkout | Owner |
| POST `/api/orders/:id/cancel` | Cancel hold or request eligible refund | Owner |
| POST `/api/orders/:id/demo-pay` | Simulate payment | Owner, local demo only |
| POST `/api/queue` | `{venueId,partySize}` | Session |
| POST `/api/queue/:id/leave` | Leave an unpaid standard queue entry | Owner |
| POST `/api/venues/:slug/ask` | `{question}` bounded policy answer | Public, rate limited |
| POST `/api/partners` | `{venueName,name,email}` | Public, rate limited |

### Order input

Use a fresh opaque `Idempotency-Key` for a new intended purchase and reuse it when retrying the same purchase. Reusing it with a different request is rejected. Amounts, currency and roles are never client inputs.

```json
{"kind":"membership","venueId":"v_copper","planId":"v_copper_shared"}
```

```json
{"kind":"ticket","venueId":"v_copper","eventId":"<published-game>","resourceId":"<available-table-or-seat>","partySize":4}
```

```json
{"kind":"season","venueId":"v_copper","team":"Dallas","season":"Demo season","resourceId":"<available-resource>","partySize":4}
```

```json
{"kind":"priority","venueId":"v_copper","queueId":"<own-standard-waiting-entry>"}
```

The result is `{orderId,url,demo?}`. Live `url` is Stripe Checkout; demo `url` is the local simulated checkout. A returned URL or a success redirect never grants access. Live payment webhooks must confirm it.

## Venue API

| Method / path | Purpose | Access |
| --- | --- | --- |
| GET `/api/staff/:venue` | Member/bottle, reservation and queue workspace | Venue staff |
| POST `/api/staff/:venue/lookup` | `{token}` current member lookup | Venue staff |
| POST `/api/staff/reservations/:id` | `{action:"attended"\|"no_show"}` | Record's venue staff |
| POST `/api/staff/queue/:id` | `{action:"called"\|"seated"}` | Record's venue staff |
| POST `/api/staff/members/:id/bottles` | `{name,capacityMl}`, retry key | Member's venue staff |
| POST `/api/staff/bottles/:id` | `{deltaMl,reason}`, retry key | Bottle's venue staff; manager for positive delta |
| POST `/api/staff/campaigns/:id/approve` | Approve reviewed campaign facts/copy | Venue manager |
| GET `/api/staff/:venue/jobs` | Unfinished Wallet/refund delivery | Venue manager |
| POST `/api/staff/jobs/:id/retry` | Reset failed delivery for retry | Subject's venue manager |

These routes are a starting point for compatible POS integrations, **not** an unauthenticated vendor webhook. A real provider adapter must verify vendor signatures, map venue/staff/member/bottle identities, and reuse provider event IDs as retry keys. Never call staff endpoints from a public POS payload without a separate authenticated integration boundary.

## Provider endpoints

`POST /api/webhooks/stripe` accepts the untouched raw JSON body and verifies `Stripe-Signature` with a bounded timestamp. It is exempt from browser Origin checks because the provider signs it.

`GET /api/wallet/apple/:membership` is owner-authenticated and returns `application/vnd.apple.pkpass`. `GET /api/wallet/google/:membership` is owner-authenticated and returns `{url}` for the signed Google save JWT.

Apple's pass web service uses:

- `POST` / `DELETE /api/wallet/apple/v1/devices/:device/registrations/:passType/:serial` with `Authorization: ApplePass <pass authentication token>`; POST body `{pushToken}`.
- `GET /api/wallet/apple/v1/devices/:device/registrations/:passType?passesUpdatedSince=<tag>` returns only that device's changed serials and a monotonic update tag, or 204.
- `GET /api/wallet/apple/v1/passes/:passType/:serial` checks ApplePass authorization and supports current revision/modified-time responses.
- `POST /api/wallet/apple/v1/log` accepts and discards bounded device diagnostic bodies; it does not persist sensitive device logs.

Apple pass authentication tokens remain stable across updates. A device's opaque library identifier follows Apple's update protocol for its list request; serial number alone cannot read the native pass.
