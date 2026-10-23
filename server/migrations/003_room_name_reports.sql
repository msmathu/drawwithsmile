-- Allow reports about inappropriate room names.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_reason_check;
ALTER TABLE reports ADD CONSTRAINT reports_reason_check
  CHECK (reason IN ('spam', 'offensive', 'cheating', 'inappropriate-drawing', 'inappropriate-room-name', 'other'));
