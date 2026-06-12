-- retention_class: incident-scoped (column lives and dies with sessions rows)
-- sha256 of each contact address: lets an inbound SMS reply ("SEND") find
-- the sessions it may dispatch for, without storing contact identity in
-- queryable form.
ALTER TABLE sessions ADD COLUMN contact_refs JSONB NOT NULL DEFAULT '[]';
