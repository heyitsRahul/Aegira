-- retention_class: durable
-- Pre-launch marketing waitlist, recorded under consent v3 (invariant 11).
-- This is ordinary signup data, not safety data: an email and an optional
-- two-letter country, de-duplicated by a hash of the email. Deliberately
-- NO location and NO link to any emergency session (invariant 1). Deleted
-- on request.
CREATE TABLE waitlist (
  email_ref       TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  country         TEXT,
  consent_version TEXT NOT NULL,
  joined_at       TIMESTAMPTZ NOT NULL
);
