-- DrawWithSmile initial schema.
-- Short-lived game state (rooms, strokes, timers) lives in server memory.
-- Only words, completed game results, statistics and moderation data are stored here.

CREATE TABLE IF NOT EXISTS word_categories (
  id          SERIAL PRIMARY KEY,
  slug        VARCHAR(40)  NOT NULL,
  language    VARCHAR(5)   NOT NULL CHECK (language IN ('en', 'ta')),
  name        VARCHAR(80)  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_word_categories_slug_language UNIQUE (slug, language)
);

CREATE TABLE IF NOT EXISTS words (
  id           SERIAL PRIMARY KEY,
  category_id  INTEGER      NOT NULL REFERENCES word_categories (id) ON DELETE CASCADE,
  text         VARCHAR(60)  NOT NULL CHECK (length(btrim(text)) > 0),
  difficulty   VARCHAR(10)  NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_words_category_text UNIQUE (category_id, text)
);
CREATE INDEX IF NOT EXISTS idx_words_active_category ON words (category_id, difficulty) WHERE active;

-- Guest players. The id is the server-issued guest id; nickname is the last
-- display name used. No e-mail, IP address or other personal data is stored.
CREATE TABLE IF NOT EXISTS players (
  id            UUID PRIMARY KEY,
  nickname      VARCHAR(32)  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_stats (
  player_id        UUID PRIMARY KEY REFERENCES players (id) ON DELETE CASCADE,
  games_played     INTEGER  NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  wins             INTEGER  NOT NULL DEFAULT 0 CHECK (wins >= 0),
  total_score      BIGINT   NOT NULL DEFAULT 0 CHECK (total_score >= 0),
  best_score       INTEGER  NOT NULL DEFAULT 0 CHECK (best_score >= 0),
  correct_guesses  INTEGER  NOT NULL DEFAULT 0 CHECK (correct_guesses >= 0),
  drawings         INTEGER  NOT NULL DEFAULT 0 CHECK (drawings >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_player_stats_total_score ON player_stats (total_score DESC);

CREATE TABLE IF NOT EXISTS game_sessions (
  id            UUID PRIMARY KEY,
  room_code     VARCHAR(8)   NOT NULL,
  visibility    VARCHAR(10)  NOT NULL CHECK (visibility IN ('public', 'private')),
  language      VARCHAR(5)   NOT NULL,
  total_rounds  SMALLINT     NOT NULL CHECK (total_rounds > 0),
  draw_time     SMALLINT     NOT NULL CHECK (draw_time > 0),
  player_count  SMALLINT     NOT NULL CHECK (player_count > 0),
  completed     BOOLEAN      NOT NULL,
  started_at    TIMESTAMPTZ  NOT NULL,
  ended_at      TIMESTAMPTZ  NOT NULL,
  CHECK (ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_ended_at ON game_sessions (ended_at DESC);

CREATE TABLE IF NOT EXISTS game_rounds (
  id               BIGSERIAL PRIMARY KEY,
  session_id       UUID         NOT NULL REFERENCES game_sessions (id) ON DELETE CASCADE,
  round_number     SMALLINT     NOT NULL CHECK (round_number > 0),
  turn_number      SMALLINT     NOT NULL CHECK (turn_number > 0),
  drawer_id        UUID         REFERENCES players (id) ON DELETE SET NULL,
  word_id          INTEGER      REFERENCES words (id) ON DELETE SET NULL,
  word_text        VARCHAR(60)  NOT NULL,
  correct_guesses  SMALLINT     NOT NULL DEFAULT 0 CHECK (correct_guesses >= 0),
  end_reason       VARCHAR(30)  NOT NULL,
  started_at       TIMESTAMPTZ  NOT NULL,
  ended_at         TIMESTAMPTZ  NOT NULL,
  CONSTRAINT uq_game_rounds_turn UNIQUE (session_id, turn_number)
);
CREATE INDEX IF NOT EXISTS idx_game_rounds_drawer ON game_rounds (drawer_id);

CREATE TABLE IF NOT EXISTS player_results (
  session_id       UUID         NOT NULL REFERENCES game_sessions (id) ON DELETE CASCADE,
  player_id        UUID         NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  nickname         VARCHAR(32)  NOT NULL,
  final_score      INTEGER      NOT NULL CHECK (final_score >= 0),
  rank             SMALLINT     NOT NULL CHECK (rank > 0),
  correct_guesses  INTEGER      NOT NULL DEFAULT 0,
  drawings         INTEGER      NOT NULL DEFAULT 0,
  is_winner        BOOLEAN      NOT NULL DEFAULT FALSE,
  PRIMARY KEY (session_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_player_results_player ON player_results (player_id);

CREATE TABLE IF NOT EXISTS achievements (
  code         VARCHAR(40)  PRIMARY KEY,
  name         VARCHAR(60)  NOT NULL,
  description  VARCHAR(200) NOT NULL,
  sort_order   SMALLINT     NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS player_achievements (
  player_id         UUID         NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  achievement_code  VARCHAR(40)  NOT NULL REFERENCES achievements (code) ON DELETE CASCADE,
  earned_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, achievement_code)
);

-- Reporter/reported ids are guest ids that may not have a players row yet, so no FK.
CREATE TABLE IF NOT EXISTS reports (
  id           BIGSERIAL PRIMARY KEY,
  reporter_id  UUID         NOT NULL,
  reported_id  UUID         NOT NULL,
  room_code    VARCHAR(8)   NOT NULL,
  reason       VARCHAR(30)  NOT NULL
               CHECK (reason IN ('spam', 'offensive', 'cheating', 'inappropriate-drawing', 'other')),
  details      VARCHAR(200),
  reported_nickname VARCHAR(32),
  status       VARCHAR(20)  NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports (reported_id);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id          BIGSERIAL PRIMARY KEY,
  room_code   VARCHAR(8)   NOT NULL,
  actor_id    UUID,
  target_id   UUID         NOT NULL,
  action      VARCHAR(20)  NOT NULL CHECK (action IN ('kick', 'ban', 'mute', 'unmute', 'vote-kick')),
  reason      VARCHAR(200),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_target ON moderation_actions (target_id, created_at DESC);
