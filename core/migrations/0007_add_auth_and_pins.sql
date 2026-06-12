-- retention_class: incident-scoped (columns live and die with sessions rows)
-- Capability tokens and per-session PIN enrollment. Only hashes are
-- stored; plaintext tokens exist once, in the trigger response and the
-- contact alert link. user_ref is sha256(user_id) — a concurrency index,
-- deliberately not reversible to identity.
ALTER TABLE sessions ADD COLUMN seeker_token_hash  TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN contact_token_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN pin_safe_hash      TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN pin_duress_hash    TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN user_ref           TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN arrival_attempts   INTEGER NOT NULL DEFAULT 0;

ALTER TABLE responders ADD COLUMN token_hash TEXT NOT NULL DEFAULT '';
