-- retention_class: durable
-- Versioned consent texts (CONSENT_RECORD, invariant 11). Append-only:
-- published versions are never edited. Sessions reference the version the
-- user consented to in their TRIGGERED event.
CREATE TABLE consent_records (
  version      TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL
);
