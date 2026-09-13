-- Optional link from a community poll back to an incident report
ALTER TABLE polls
  ADD COLUMN IF NOT EXISTS report_id UUID REFERENCES reports(id) ON DELETE SET NULL;
