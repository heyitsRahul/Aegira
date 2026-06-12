-- retention_class: durable
-- Verified-responder directory. availability_cell is a coarse ~1 km grid
-- id (a zone, not a position); precise responder locations are never
-- stored. No numeric reputation column may ever be added here
-- (invariant 10) — eligibility derives from discrete strike records.
CREATE TABLE responders (
  id                TEXT PRIMARY KEY,
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  availability_cell TEXT NOT NULL,
  enrolled_at       TIMESTAMPTZ NOT NULL
);
