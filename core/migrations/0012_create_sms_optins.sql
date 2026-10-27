-- retention_class: durable
-- Numbers that texted JOIN to agree to receive alert SMS, recorded under
-- consent v6 (invariant 11). Only a sha256 of the E.164 number is kept,
-- never the number itself: the guard checks a destination it already has
-- against this list. No name, no location (invariant 1). Deleted when the
-- number texts STOP.
CREATE TABLE sms_optins (
  phone_ref       TEXT PRIMARY KEY,
  consent_version TEXT NOT NULL,
  joined_at       TIMESTAMPTZ NOT NULL
);
