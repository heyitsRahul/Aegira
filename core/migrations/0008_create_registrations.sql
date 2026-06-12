-- retention_class: durable
-- SMS/lite-channel registrations, recorded under consent v2 (invariant
-- 11): name, trusted contact numbers, PIN hashes. Deleted when the user
-- texts STOP. Deliberately contains NO location columns — location only
-- ever enters the system together with a session trigger (invariant 1).
CREATE TABLE registrations (
  phone_ref       TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  contacts        JSONB NOT NULL,
  pin_safe_hash   TEXT NOT NULL,
  pin_duress_hash TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  registered_at   TIMESTAMPTZ NOT NULL
);
