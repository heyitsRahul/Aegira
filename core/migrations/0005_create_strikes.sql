-- retention_class: durable
-- Strikes, not scores (invariant 10): each row is a discrete,
-- human-reviewable, appealable record. Aggregating these into a hidden
-- numeric reputation is forbidden.
CREATE TABLE strikes (
  id           TEXT PRIMARY KEY,
  responder_id TEXT NOT NULL REFERENCES responders (id),
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('open', 'upheld', 'dismissed')),
  appeal_note  TEXT,
  created_at   TIMESTAMPTZ NOT NULL
);
