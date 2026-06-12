-- retention_class: durable
-- Hash-chained append-only audit log. Events carry NO identity and NO
-- location (those live only as session-key-encrypted blobs elsewhere), so
-- the chain can be retained for audit after the session is purged.
CREATE TABLE session_events (
  session_id UUID NOT NULL REFERENCES sessions (id),
  seq        INTEGER NOT NULL,
  type       TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL,
  data       JSONB NOT NULL,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
