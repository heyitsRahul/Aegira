-- retention_class: incident-scoped
-- Invariant 1: a location row cannot exist without a session.
-- session_id is NOT NULL by design and the point itself is stored only as
-- a session-key-encrypted blob — there are no plaintext lat/lng columns.
-- Purge path: crypto-shred of the session key, then row sweep.
CREATE TABLE location_pings (
  id              BIGSERIAL PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES sessions (id),
  encrypted_point BYTEA NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL
);
