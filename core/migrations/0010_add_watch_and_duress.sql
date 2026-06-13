-- retention_class: incident-scoped (columns live and die with sessions rows)
-- Journey-watch deadline and the duress mask, supporting the timed
-- check-in lifecycle (WATCHING) and its duress discipline.
--   watch_deadline: when an unattended watch escalates to a real emergency.
--   duress_kind: the faked-benign timeline the coerced device must keep
--                showing — 'cancelled' (duress cancel) or 'resolved'
--                (duress check-in); NULL when not under duress.
-- Both are destroyed with the rest of the row on purge (crypto-shred then
-- sweep); neither stores a location.
ALTER TABLE sessions ADD COLUMN watch_deadline   TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN duress_kind      TEXT
  CHECK (duress_kind IN ('cancelled', 'resolved'));
ALTER TABLE sessions ADD COLUMN duress_at        TIMESTAMPTZ;
