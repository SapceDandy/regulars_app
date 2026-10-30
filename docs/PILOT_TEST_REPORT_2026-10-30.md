# Regulars synthetic pilot test report — October 30, 2026

Tested deployment: https://regulars-afyia2gbr-sapcedandy-s-team.vercel.app

Code: `da80f030c42482aed999049bb635b3a3b87f901e`. Vercel deployment `dpl_7DyMdDiCribSEb2ikaVziybMEPmn`. Protected preview only; no production rollout. Vercel Authentication remains enabled. The separate Neon `regulars_pilot` schema contains fictional fixtures. External provider requests are blocked. No texts, card charges or external campaign messages were sent.

## Hosted browser results

| Workflow | Observed result |
| --- | --- |
| Discovery | Search by city and empty results work; filtered count correctly shows 1 sample venue. |
| Test sessions | Guest, second guest and manager fixtures work; signout works; guest denied staff access. |
| Guest pass and locker | Free pass upgraded through simulated $69 checkout to shared locker L01, position 1; state persisted. |
| Season reservations | Four Table 1 bookings for party 4, 10% discount, $172.13 total; confirmed dates and deadlines shown. |
| Resource exclusion | Second guest could not select the already-booked Table 1; 11 resources remained. This was sequential, not a hosted contention test. |
| Cancellation | All four season reservations removed; simulated refund reached refunded after reload. Membership and priority remained intact. |
| Bottle service | Received 750 mL, served 45 mL, manager corrected +45 with reason; guest and manager both saw persisted 750 mL. |
| Queue | Joined standard lane, simulated $25 priority upgrade, manager called and seated group; queue cleared. |
| Staff status | Dashboard ended at $94 collected orders, one membership, zero upcoming reservations and zero unfinished jobs. Future-game check-in/no-show controls were disabled before cancellation. |
| Inquiry | Fictional venue and example.invalid email submitted; receipt shown. This stores a lead, not an email notification. |
| Promotion | First draft approved; copy/link action appeared; next draft remained unapproved. No publishing performed. |
| Responsive UI | Chromium frame checks: venue 320/390/768, partners 320, directory 390, login 320, account 320, staff 390; no page-level horizontal overflow. Staff tabs intentionally scroll within their row. |

## Fixes made and verified

- Logo and navigation overlapped at 320 px. Narrow headers now wrap into two rows; controls have 44 px minimum heights. Recheck found no header overlap.
- Search count previously remained at two after filtering. It now updates with results and singular/plural wording; Round Rock returned one sample venue.
- Pass expiration lacked a year. Guest account now shows the full date, including 2026.
- Added a preview-only responsive workbench at `/pilot` and nonsecret fixture buttons on sign-in for repeatable UI rehearsal.

## Automated verification

`npm run check` passed. SQLite suite: 57/57. Embedded PostgreSQL/PGlite suite: 57/57. New regressions cover preview-only activation, production rejection, blocked external requests and real phone numbers, separate schema initialization, fixture role restrictions, origin checks and workbench URL allowlisting. PGlite is not hosted Neon contention evidence; the disk-based multi-process race test uses SQLite.

## Remaining checks and launch gates

- Real Twilio verification/delivery and carrier failure behavior require the account/configuration.
- Existing payments use Stripe. Square is not integrated; selecting Square requires an adapter implementation and sandbox verification, not simply entering credentials.
- Real payment checkout, signed provider webhooks, reconciliation and provider refunds remain unverified; simulated success is not payment certification.
- Apple/Google Wallet issuer setup and physical-device installation/refresh remain unverified.
- Real iOS/Android touch, keyboard/screen-reader accessibility, load testing, hosted concurrent Neon workers, cron delivery, backups/restore and staff rehearsal remain open.
- Active-day check-in, every membership variant, profile editing, FAQ UI and calendar download were not all independently rehearsed in this browser round. Relevant domain tests do not replace those UI checks.
- Minor observed copy polish remains: the account bottle count can read “1 bottles on your shelf.”
- Fictional venues, illustrative prices, schedules and terms need operator review before real customers. No production readiness or real partner approval is claimed.

To rehearse: open the protected preview, use My Regulars and the Test guest / Second guest / Test manager buttons. Sign out to switch persona. `/pilot` provides page and viewport selectors. Fixture state persists between sessions and deployments on the pilot branch.
