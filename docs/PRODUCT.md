# Product scope and implementation decisions

## Strategic reference

Regulars connects physical venues to a digital guest relationship: belonging, repeat participation, visits with friends and the experience of being a regular. Lockers and game days introduce that system. It is broader than storage rental or an events agency.

Read the original Regulars Brain `knowledge/current-concept.md`, `knowledge/decisions.md`, `specs/mvp.md` and `specs/data-and-workflows.md`. Copies recovered from the prepared October 15, 2026 Brain are included under `product-reference/`; originals remain unchanged. The concept repository is now available at [SapceDandy/regulars_brain](https://github.com/SapceDandy/regulars_brain). The bundled reference copies reflect the October 15 source archive; consult the Brain for later concept updates.

## Latest owner request — October 15, 2026

Build a separate application repository with a lightweight public site; location-specific enrollment; phone-plus-text-code accounts; Apple and Google membership passes showing bottle stock; simple venue operations; venue discovery; team/game season passes and table or bar-seat tickets for specific time windows; prices increasing near the deadline; configurable arrival grace near fifteen minutes; and a paid-priority second line with steep price escalation. Include the venue/operator and promotion experience. Prefer the structure that is easiest to maintain and test.

This request expands game ticketing and priority access into the software pilot. Older Brain documents may place broader game automation later. The latest instruction takes precedence for these particular features.

## First-release defaults — proposed, editable

| Item | Implemented default | Reason / limit |
| --- | --- | --- |
| Repository | One monorepo | One rule set and one test/deployment path |
| Membership billing | One payment for a fixed term; manual renewal | Avoid automatic billing before benefits and operations are proven |
| Sample paid plans | $69 shared / $99 private for 30 days | Illustrative tests, not adopted or researched live prices |
| Guest pass | Free, no locker | Lightweight enrollment; does not reserve seating |
| Physical pilot | 12 lockers; sample 8 shared × 2 positions and 4 private | Demo capacity only; review physical configuration before live use |
| Seats | Allocated tables or individual bar seats | Locker capacity never implies seat capacity |
| Season ticket | Same resource for every published upcoming game in one team/season | All included games must allocate atomically; later-added games are not silently included |
| Pricing | Base, ×1.25 within 72h, ×1.5 within 24h | Server computes total; sales close at kickoff |
| Season pricing | 10% off the current total of included games | Proposed test rule; exact games shown before purchase |
| Checkout hold | 31 minutes | Inventory and Stripe session expire together; late payment is refunded rather than displacing a buyer |
| Arrival | Venue-configured grace, sample kickoff +15 minutes | Staff check-in/release; no background release of an occupied table |
| Priority lane | Four groups maximum; $25 / $50 / $100 / $200 in the demo | Small escalating test; no promise of a specific wait |
| Queue relationship | Priority within the enabled venue walk-in queue | Never overrides confirmed reservations; external queue software is not connected |
| Bottle balance | mL recorded by authorized staff | A recorded estimate, not a sensor or exact physical measurement |
| Service UI | One-tap 45 mL, custom negative amounts, manager positive corrections | Staff can use a browser or compatible POS container; vendor integration still needed |
| FAQ assistant | Deterministic answers using venue facts and escalation | No model spend or invented availability/refunds |
| Promotion | Two event-based draft campaigns and reviewed share copy | No outbound automated sends in this release |

## Acceptance journeys

1. Discover venue → choose guest/paid membership → phone verification → confirmed payment where required → assigned capacity → current account/pass.
2. Choose game/resource/group size → review window and terms → hold → verified payment → confirmed reservation → staff check-in or late release.
3. Choose season → verify every game fits → one payment → one allocated reservation per included game. A conflict rolls back the whole purchase.
4. Scan/paste pass → authenticated staff checks current record → physical service → one-tap record → audited stock delta → asynchronous Wallet refresh.
5. Join standard queue → see enabled priority price → purchase → confirmed priority position → staff calls and seats group. An unpaid/expired priority hold returns to standard.
6. Operator approves campaign facts → copies venue link/post → records attendance separately from bookings. Report observed counts without claiming incremental lift.

## Scope kept for later

Real POS vendor adapters, imported third-party waitlists, Stripe Connect settlement, automated subscription billing, member groups/guest privileges, staff invitations and configuration UI, autonomous consent-aware SMS campaigns, richer AI coordination, presence sensing and game automation. No wagering or automatic game-triggered drinks rewards are implemented.
