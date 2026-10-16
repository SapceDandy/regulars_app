# Data and workflow proposal

These are proposed implementation details, not owner-adopted database schema or audited code. Keep live patron data outside this documentation repository.

## Minimal records

| Record | Proposed fields/purpose |
| --- | --- |
| Venue | ID, approved facts, contact, hours, staff roles, service terms |
| Guest/member | ID, contact, communication permissions, status, group permissions |
| Membership | Member, tier, venue, start/expiry, renewal/payment reference, entitlement snapshot |
| Locker/position | Venue, physical ID, whole/shared mode, available positions, assignment periods |
| Bottle/service log | Venue-approved bottle ID, assignment, staff, timestamp, stock/service change, correction reference |
| Seat request/reservation | Event/time, party size, requested inventory, state, confirmation, grace/cancellation rule |
| Event/campaign | Approved facts, content, channel, schedule, RSVP and attendance references |
| Message | Recipient reference, permission basis, approved template, send status, opt-out status |
| Audit/exception | Actor, action, time, changed record, reason, resolution owner |

Use processor references instead of raw card details. Collect preferences only when useful and authorized. Define retention and role access before collecting production data. Guest contacts and bottle records should not be exposed to other members by default.

## State rules

Membership: pending → active after confirmed payment or authorized comp → past-due/expired/cancelled under agreed terms. A payment retry must not duplicate membership or charges. Cancellation is distinct from refund; terms determine entitlements through the paid period.

Locker: available → held → assigned → released under approved terms. Whole-locker and shared-position sale modes are mutually exclusive for overlapping periods. Record changes in one authoritative workflow to prevent conflicting assignments.

Seating: requested → confirmed OR waitlisted/declined → attended/cancelled/no-show. An acknowledgement is not confirmation. Staff can override with a reason and a recorded change. A member's locker does not reserve a seat unless the membership explicitly includes allocated seating rights.

Bottle service: authorized staff check identity and entitlement, perform permitted service, log the change and reconcile exceptions. Corrections should retain the original history. Software records do not authorize a physical service independently of venue staff.

## AI operation

The assistant reads approved venue facts and current inventory; prepares or sends only within the venue's authorized workflow; and routes uncertainty, refunds, capacity disputes and service exceptions to staff. Log bookings and outbound messages. Use explicit permission and opt-out handling for promotional communication. Require venue approval before a new campaign or changed offer goes live. Initial AI scope is questions, reminders and invitations; autonomy expands only after rehearsals and measured reliability.

Proposed integrations remain undecided: payment processor, pass format, messaging provider, POS connection and implementation stack. Choose them against the MVP acceptance checks rather than assuming the KUDJO application already supplies Regulars functionality.
