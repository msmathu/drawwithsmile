-- Game modes (chaos, collaborative, voting, teams), Language Battle and rewards.
-- Additive only: existing rows and queries keep working.

-- Language Battle: allow new language codes later without another migration.
ALTER TABLE word_categories DROP CONSTRAINT IF EXISTS word_categories_language_check;
ALTER TABLE word_categories ADD CONSTRAINT word_categories_language_check CHECK (language ~ '^[a-z]{2,3}$');

-- Curated accepted answers: synonyms, spelling variants, transliterations.
ALTER TABLE words ADD COLUMN IF NOT EXISTS accepted TEXT[] NOT NULL DEFAULT '{}';

-- Rules a game was played with (mode, teams, voting…), for history and analytics.
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS rules JSONB;

-- Extra per-game results.
ALTER TABLE player_results ADD COLUMN IF NOT EXISTS team SMALLINT;
ALTER TABLE player_results ADD COLUMN IF NOT EXISTS team_win BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE player_results ADD COLUMN IF NOT EXISTS votes_received INTEGER NOT NULL DEFAULT 0;

-- Extra lifetime statistics that unlock rewards.
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS quick_guesses    INTEGER NOT NULL DEFAULT 0 CHECK (quick_guesses >= 0);
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS perfect_drawings INTEGER NOT NULL DEFAULT 0 CHECK (perfect_drawings >= 0);
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS collab_drawings  INTEGER NOT NULL DEFAULT 0 CHECK (collab_drawings >= 0);
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS chaos_turns      INTEGER NOT NULL DEFAULT 0 CHECK (chaos_turns >= 0);
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS votes_received   INTEGER NOT NULL DEFAULT 0 CHECK (votes_received >= 0);
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS team_wins        INTEGER NOT NULL DEFAULT 0 CHECK (team_wins >= 0);

-- Selected cosmetics. The server only stores values the player has unlocked.
ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_id SMALLINT CHECK (avatar_id >= 0);
ALTER TABLE players ADD COLUMN IF NOT EXISTS title_id  VARCHAR(40);

INSERT INTO achievements (code, name, description, sort_order) VALUES
  ('QUICK_GUESSER',   'Quick Guesser',   'Guess 10 words within 15 seconds of the drawing starting.', 7),
  ('MASTER_DOODLER',  'Master Doodler',  'Have 10 of your drawings guessed by everyone.',             8),
  ('TEAM_CHAMPION',   'Team Champion',   'Win a Team Battle.',                                        9),
  ('CHAOS_SURVIVOR',  'Chaos Survivor',  'Guess or get your drawing guessed in 5 Chaos turns.',       10),
  ('TEAM_PLAYER',     'Team Player',     'Share the pen in 3 collaborative drawings.',                11),
  ('CREATIVE_LEGEND', 'Creative Legend', 'Receive 10 votes for your drawings.',                       12)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;
