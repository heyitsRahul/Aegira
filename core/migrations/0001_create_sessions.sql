-- retention_class: incident-scoped
-- Purge path: per-session key destruction (crypto-shred) renders
-- encrypted_pii unreadable at PURGED; rows are swept after PURGED.
-- Note: no plaintext identity and no location columns here. The only
-- location-derived value is the coarse (~1 km) cell, and the row itself
-- IS the session, so no location ever exists without a session_id.
CREATE TABLE sessions (
  id            UUID PRIMARY KEY,
  state         TEXT NOT NULL,
  category      TEXT NOT NULL,
  alias         TEXT NOT NULL,
  coarse_cell   TEXT NOT NULL,
  key_id        TEXT NOT NULL,
  encrypted_pii BYTEA,
  created_at    TIMESTAMPTZ NOT NULL
);
