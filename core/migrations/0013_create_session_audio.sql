-- retention_class: incident-scoped
-- Opt-in sound recording during a live session (consent v8).
-- Every row belongs to a session (session_id NOT NULL) and the sound itself
-- is stored only as a session-key-encrypted blob: no plaintext audio and no
-- location columns. Pieces of one recording share a segment id and are
-- ordered by seq.
-- Purge path: crypto-shred of the session key (CLOSED -> PURGED) makes every
-- blob unreadable, then a row sweep removes the dead ciphertext.
CREATE TABLE session_audio (
  session_id     UUID NOT NULL REFERENCES sessions (id),
  segment        TEXT NOT NULL,
  seq            INTEGER NOT NULL CHECK (seq >= 0),
  encrypted_clip BYTEA NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (session_id, segment, seq)
);
