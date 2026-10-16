PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES(1);
CREATE TABLE IF NOT EXISTS wallet_revision(id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL);
INSERT OR IGNORE INTO wallet_revision VALUES(1,0);
CREATE TABLE IF NOT EXISTS venues(
 id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, city TEXT NOT NULL,
 description TEXT NOT NULL, address TEXT NOT NULL, timezone TEXT NOT NULL,
 terms TEXT NOT NULL, grace_minutes INTEGER NOT NULL CHECK(grace_minutes BETWEEN 0 AND 60),
 priority_enabled INTEGER NOT NULL DEFAULT 0, priority_base_cents INTEGER NOT NULL DEFAULT 2500,
 demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
 marketing_opt_in INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff(
 user_id TEXT NOT NULL REFERENCES users(id), venue_id TEXT NOT NULL REFERENCES venues(id),
 role TEXT NOT NULL CHECK(role IN('staff','manager')), PRIMARY KEY(user_id,venue_id)
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges(
 phone TEXT PRIMARY KEY, code_hash TEXT, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lockers(
 id TEXT PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venues(id), label TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN('shared','private')), positions INTEGER NOT NULL CHECK(positions BETWEEN 1 AND 8),
 CHECK(mode='shared' OR positions=1), UNIQUE(venue_id,label)
);
CREATE TABLE IF NOT EXISTS plans(
 id TEXT PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venues(id), name TEXT NOT NULL,
 mode TEXT CHECK(mode IN('shared','private')), price_cents INTEGER NOT NULL CHECK(price_cents>=0),
 duration_days INTEGER NOT NULL CHECK(duration_days>0), benefits TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events(
 id TEXT PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venues(id), title TEXT NOT NULL,
 team TEXT NOT NULL, season TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
 base_price_cents INTEGER NOT NULL CHECK(base_price_cents>=0), published INTEGER NOT NULL DEFAULT 1,
 CHECK(ends_at>starts_at)
);
CREATE TABLE IF NOT EXISTS resources(
 id TEXT PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venues(id), label TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('table','stool')), capacity INTEGER NOT NULL CHECK(capacity>0),
 UNIQUE(venue_id,label)
);
CREATE TABLE IF NOT EXISTS orders(
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), venue_id TEXT NOT NULL REFERENCES venues(id),
 kind TEXT NOT NULL CHECK(kind IN('membership','ticket','season','priority')),
 state TEXT NOT NULL CHECK(state IN('held','paid','expired','cancelled','refund_pending','refunded')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), currency TEXT NOT NULL DEFAULT 'usd',
 details TEXT NOT NULL, idempotency_key TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 stripe_session TEXT UNIQUE, payment_intent TEXT, checkout_url TEXT,
 UNIQUE(user_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS memberships(
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), venue_id TEXT NOT NULL REFERENCES venues(id),
 plan_id TEXT NOT NULL REFERENCES plans(id), status TEXT NOT NULL CHECK(status IN('active','expired','cancelled')),
 starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, order_id TEXT UNIQUE REFERENCES orders(id),
 pass_token TEXT UNIQUE NOT NULL, pass_auth TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 next_refresh_at INTEGER NOT NULL DEFAULT 0,
 pass_updated_at INTEGER NOT NULL DEFAULT 0,
 UNIQUE(user_id,venue_id)
);
CREATE TABLE IF NOT EXISTS locker_allocations(
 id TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL REFERENCES orders(id),
 membership_id TEXT REFERENCES memberships(id), locker_id TEXT NOT NULL REFERENCES lockers(id),
 position INTEGER NOT NULL CHECK(position>0), state TEXT NOT NULL CHECK(state IN('held','active','released')),
 starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS locker_overlap ON locker_allocations(locker_id,position,state,starts_at,ends_at);
CREATE TABLE IF NOT EXISTS reservations(
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), event_id TEXT NOT NULL REFERENCES events(id),
 resource_id TEXT NOT NULL REFERENCES resources(id), party_size INTEGER NOT NULL CHECK(party_size>0),
 state TEXT NOT NULL CHECK(state IN('held','confirmed','attended','cancelled','no_show','released')),
 starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, checkin_deadline INTEGER NOT NULL,
 checked_in_at INTEGER, UNIQUE(order_id,event_id), CHECK(ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS reservation_overlap ON reservations(resource_id,state,starts_at,ends_at);
CREATE TABLE IF NOT EXISTS queue_entries(
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), venue_id TEXT NOT NULL REFERENCES venues(id),
 order_id TEXT UNIQUE REFERENCES orders(id), lane TEXT NOT NULL CHECK(lane IN('standard','priority')),
 state TEXT NOT NULL CHECK(state IN('held','waiting','called','seated','left')),
 party_size INTEGER NOT NULL, created_at INTEGER NOT NULL, called_at INTEGER
);
CREATE INDEX IF NOT EXISTS queue_live ON queue_entries(venue_id,state,created_at);
CREATE TABLE IF NOT EXISTS bottles(
 id TEXT PRIMARY KEY, membership_id TEXT NOT NULL REFERENCES memberships(id), name TEXT NOT NULL,
 capacity_ml INTEGER NOT NULL CHECK(capacity_ml>0), remaining_ml INTEGER NOT NULL CHECK(remaining_ml>=0),
 CHECK(remaining_ml<=capacity_ml)
);
CREATE TABLE IF NOT EXISTS bottle_log(
 id TEXT PRIMARY KEY, bottle_id TEXT NOT NULL REFERENCES bottles(id), actor_id TEXT NOT NULL REFERENCES users(id),
 delta_ml INTEGER NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL,
 idempotency_key TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS audit(
 id TEXT PRIMARY KEY, venue_id TEXT REFERENCES venues(id), actor_id TEXT REFERENCES users(id),
 action TEXT NOT NULL, subject_id TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_events(id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject_id TEXT NOT NULL, payload TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 last_error TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS apple_registrations(
 device_id TEXT NOT NULL, membership_id TEXT NOT NULL REFERENCES memberships(id), push_token TEXT NOT NULL,
 PRIMARY KEY(device_id,membership_id)
);
CREATE TABLE IF NOT EXISTS campaigns(
 id TEXT PRIMARY KEY, venue_id TEXT NOT NULL REFERENCES venues(id), title TEXT NOT NULL,
 body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN('draft','approved')),
 event_id TEXT REFERENCES events(id), created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS leads(
 id TEXT PRIMARY KEY, venue_name TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, created_at INTEGER NOT NULL
);
