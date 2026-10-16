# MVP specification

Status: proposed operational specification derived from the owner-approved October 15 concept. It does not document a completed build. Launch unit: one venue and twelve usable physical lockers.

## Roles and core behavior

| Area | Intended behavior | Acceptance evidence |
| --- | --- | --- |
| Venue setup | Record approved hours, contacts, seat inventory, membership rules and service procedures | Venue representative signs off on the configuration and staff responsibilities. |
| Enrollment | Create a free guest/pass or paid membership with explicit benefit and renewal terms | Test member can enroll, view status and understand charges; no duplicate billing on a retried payment event. |
| Allocation | Assign whole lockers or named shared positions, never both on the same sold capacity | A concurrent request cannot double-allocate a locker/position; expired memberships follow an agreed release process. |
| Pass | Provide a scannable pass or supported equivalent linked to current membership | Staff lookup returns current status; a screenshot cannot make an expired benefit active. |
| Staff view | Show approved member, group, locker and seating arrangements on a usable device | Staff complete a realistic lookup and exception flow in a measured rehearsal. |
| Bottle records | Authorized staff record permitted stock and service changes | Each change has staff identity and time; discrepancies can be reconciled against physical stock. |
| Seating | Accept requests against separately defined seat capacity; confirm only after a valid allocation | Overlapping requests do not double-book inventory; waitlist, cancellation and late arrival have explicit states. |
| AI coordination | Answer approved venue questions; send opted-in reminders/invitations; escalate exceptions | Assistant cannot invent availability, benefits or refunds, and an opt-out stops promotional sends. |
| Events | Plan and digitally promote two approved occasions/month | Owner approves event facts; RSVP, attendance and follow-up are recorded separately. |
| Reporting | Report memberships, renewals, requests, attendance, spend where available and service effort | Every reported result has a stated denominator, source and missing-data caveat. |

## Physical launch

Confirm the site, cabinet dimensions, permissible installation, design, load, mounting, locks and staff access before purchasing or installing. The three four-cube cabinet idea and left-side locks are design preferences, not a verified engineered system. Bottle count and hanging load need actual measurements and qualified installation review. Twelve lockers do not automatically mean forty-eight memberships; shared-position count must fit the agreed physical and operating design. Store only items the venue is authorized to hold and serve under its approved procedures.

## Proposed release sequence

1. Approve venue offer, inventory, operating rules and actual installation quote.
2. Demonstrate enrollment → payment/status → allocation/pass → staff lookup → service record.
3. Demonstrate seating request → confirmation/waitlist → reminder → attendance/cancellation.
4. Rehearse failure paths: expired membership, disputed stock, full inventory, declined payment and AI escalation.
5. Launch a small member cohort and the first approved occasion; reconcile records and effort weekly.
6. Run the second occasion, renewals and return-visit measurement; decide continuation using evidence.

## Later capabilities

Broader live game automation, sponsor settlement, multi-venue identity, advanced personalization and operational intelligence require additional evidence and specs. Passive presence detection is not assumed in the MVP. Unapproved wagering, points-to-alcohol schemes and automatic game-triggered alcohol rewards are not pilot deliverables. Staff remain responsible for onsite service and exceptions.

## Definition of ready

The agreement matches the demo; installation is usable and signed off; staff complete rehearsals; payment and receipt behavior is tested; inventory and seating cannot be oversold; contacts and messaging permissions are configured; incident ownership and a manual fallback are named. Record real test results separately before claiming readiness.
