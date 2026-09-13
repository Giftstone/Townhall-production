-- database/migrations/001_add_report_responses_and_wards_index.sql
-- ============================================================
-- Run this manually in psql:
--   psql -U postgres -d townhall -f migrations/001_add_report_responses_and_wards_index.sql
-- ============================================================

-- 1. Report Responses table
--    Allows responders/admins to post comments/updates on individual reports.
CREATE TABLE IF NOT EXISTS report_responses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id)   ON DELETE SET NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by report
CREATE INDEX IF NOT EXISTS idx_report_responses_report_id
  ON report_responses (report_id);

-- 2. Make sure the wards table has data indexed for analytics
--    (wards are seeded separately via seeds.sql)
CREATE INDEX IF NOT EXISTS idx_reports_location
  ON reports (location);

-- 3. Confirm
SELECT 'Migration 001 applied successfully ✅' AS status;
