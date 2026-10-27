-- Automatic permanent bans after many reports.
-- reporter_key: hashed public IP of the reporter (or "player:<id>" on shared/private networks),
-- so one person with many guest accounts is counted once.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter_key VARCHAR(80);
-- Keyed hash (HMAC) of the reported player's IP; plain IP addresses are never stored.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reported_ip_hash VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_reports_reported_key ON reports (reported_id, reporter_key);

CREATE TABLE IF NOT EXISTS player_bans (
  id            BIGSERIAL PRIMARY KEY,
  player_id     UUID         NOT NULL,
  ip_hash       VARCHAR(64),
  reason        VARCHAR(200) NOT NULL,
  report_count  INTEGER      NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_player_bans_player ON player_bans (player_id);
CREATE INDEX IF NOT EXISTS idx_player_bans_ip ON player_bans (ip_hash) WHERE ip_hash IS NOT NULL;
