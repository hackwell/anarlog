-- The customer a meeting belongs to, as an organizations.id. Empty means
-- unassigned. Additive with a default so older builds still open the database.
ALTER TABLE sessions ADD COLUMN organization_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_sessions_organization_id ON sessions(organization_id);
