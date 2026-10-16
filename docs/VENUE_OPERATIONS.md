# Venue workflow and promotion

## Guest experience

Every venue shares `/v/<slug>`: published games, available places, membership benefits, terms and queue entry. Guests authenticate only when they enroll, purchase or view their account. A native app is not required. Their account and saved Wallet pass show current membership and the last bottle balance recorded by staff.

Each game booking covers a known table or bar seat, party size and time window. The confirmation shows the arrival deadline. A season pass lists all included games at purchase. Lockers and seats are distinct purchases unless a future explicitly allocated product combines them.

## Minimal staff actions

1. Start of shift: open `/staff/<slug>` once on an approved device, or in a compatible existing venue/POS web container. Sign in with an operator-approved phone.
2. Arrival: find the reservation and tap **Check in**. After the grace period, staff can mark a no-show and release the place. Software does not silently evict an occupied table.
3. Locker service: scan/paste the Wallet member code into the existing lookup field. Verify current status and physical identity. Receive a bottle once, then tap **Serve 45 mL** after service, or use a custom service amount. Only managers make positive stock corrections.
4. Door: use the standard/priority queue view, call a group and mark seated. Staff still honor reservations, capacity and onsite judgment.
5. End of shift: compare physical bottle stock to records, document corrections, and inspect any delivery/refund failures.

No system can update bottle balances accurately without a trustworthy source event. This pilot requires a staff tap or a future POS event. It does not infer pours from pass scans, staff presence or a payment with no matched bottle/service detail.

## Avoiding another app

The staff view is a responsive web page and can run in a compatible POS browser/sidebar. Public location pages can be linked from a bar website. Set `EMBED_ORIGINS` to exact approved HTTPS website origins if an iframe is needed.

Example public embed:

```html
<iframe src="https://your-regulars-domain/v/your-venue" title="Book with Regulars" width="100%" height="900"></iframe>
<a href="https://your-regulars-domain/v/your-venue" target="_blank" rel="noopener">Open bookings</a>
```

Use the top-level link for sign-in/checkout. Third-party cookie restrictions can prevent an authenticated account from working inside an unrelated website iframe. Real POS products also have vendor-specific extension and approval rules; an allowlisted iframe is not proof that a product supports embedding.

The next adapter should match the first venue's actual POS. It needs verified incoming events, location/staff identity, a member/bottle mapping and unique event IDs. Where a vendor cannot provide that data, keep the one-tap workflow. Do not claim an integration exists based on having a URL.

## Paid priority

Do not enable it while an unrelated system remains the authoritative queue unless staff can keep the two in sync or a supported adapter is implemented. In this release, the venue explicitly manages the Regulars walk-in list. Priority is limited, price escalates with active priority slots, and a checkout hold temporarily consumes a slot. If it expires, the guest returns to standard without losing their original standard join time.

Priority changes only the walk-in lane. It never alters a paid table reservation, promises a particular wait or creates an extra physical table.

## Promotion

The guest-facing landing page explains the value; the directory helps discovery; the venue page turns interest into a booking/membership. It has a stable URL that can be linked from the venue's site, social bio, event post, table signage and receipts.

Managers get two generated campaign drafts from the venue's published games, then approve facts before copying text with a UTM-tagged venue link. Publishing still happens in the venue's existing social/email workflow. The app does not post or message anyone on its own.

Live pages have venue titles/descriptions, canonical links, a sitemap and crawler rules protecting private paths. Demo pages are noindex. Complete live content, venue imagery, structured local/event data, analytics and verified directory profiles before treating this as an SEO program. UTM links are created, but conversion analytics and attribution ingestion are not yet implemented.

## What the business can evaluate

Active membership count, collected order value, upcoming confirmations, staff-recorded attendance, service actions and sync/refund status. These are direct system records. They do not establish incremental sales, profit, reduced staff effort or improved retention. The pilot should separately time service tasks, reconcile POS totals and record return visits before making those claims.
