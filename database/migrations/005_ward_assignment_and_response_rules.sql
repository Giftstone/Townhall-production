-- Migration 005: Strengthen ward assignment for responders + response ownership
-- 1. Ensure responders should have a ward_id (soft rule; enforced in app logic)
-- 2. Index for fast ward-based analytics
CREATE INDEX IF NOT EXISTS idx_users_ward_id ON users (ward_id);
CREATE INDEX IF NOT EXISTS idx_reports_assigned_to ON reports (assigned_to);
CREATE INDEX IF NOT EXISTS idx_reports_category ON reports (category);

-- Optional helper view: reports by ward (matched via location name or future ward_id on reports)
-- For now analytics will match reports.location to wards.name or use assigned responder's ward.
