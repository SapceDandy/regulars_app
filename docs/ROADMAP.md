# Next iterations

## Before the first paid pilot

1. Connect the first venue's approved identity, actual floor/locker inventory, terms, schedule and staff roles. Provision a fresh environment and durable database.
2. Complete SMS, Stripe sandbox/refund, iPhone and Android Wallet rehearsals. Verify failure paths and current-state checks from real devices.
3. Finish responsive/browser/accessibility QA, business privacy/support/retention copy, signed venue scope, physical installation and staff training.
4. Rehearse payment reconciliation, daily stock check, backup restoration and incident ownership. Measure staff seconds per arrival/pour/correction.
5. Ship one small cohort. Evaluate actual joins, bookings, arrivals, return visits, refunds and service effort; do not scale from mock data.

## Next useful engineering work

| Priority | Work | Exit evidence |
| --- | --- | --- |
| P1 | Operator venue/game editor with safe migrations | New games can publish; existing paid bookings cannot silently move |
| P1 | Staff invitations, revocation and stronger manager authentication | Former staff lose access; role changes are audited |
| P1 | First actual POS adapter | Signed provider events map venue/staff/member/bottle; duplicates produce one stock change |
| P1 | Support, account recovery, retention and data export/deletion | Authenticated requests complete without erasing required payment/audit history improperly |
| P1 | Settlement/refund reconciliation and monitoring | App/processor mismatches create an actionable exception |
| P2 | Reservation/waitlist integration for the first vendor | One authoritative capacity/queue view; reservations survive priority upgrades |
| P2 | Stripe Connect for independent venues | Each venue's funds, refunds and ledger reconcile to its connected merchant |
| P2 | Optional recurring memberships | Explicit recurring consent, renewal/failure/cancellation handling and inventory extension tests |
| P2 | Group/guest membership | Permissions and shared bottle ownership are explicit and revocable |
| P2 | Transactional reminders and invitations | Approved templates, permissions/STOP handling, quiet hours and delivery receipts |
| P2 | Acquisition measurement | Venue/campaign links connect to confirmed conversion and attendance with honest denominators |
| P3 | Richer bounded AI coordination | Approved facts and current inventory only; autonomous actions have permissions and audit |
| P3 | Postgres and leased workers | Concurrent workers claim one job; operational load justifies the migration |

Do not add a separate app or service merely because it can be built. Keep guests on the lightest path and integrate staff actions into their actual working environment. Broad game automation, sponsors and sensing follow evidence from the core loop.
