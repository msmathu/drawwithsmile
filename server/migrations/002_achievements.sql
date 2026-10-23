-- Reference data: achievement definitions.
INSERT INTO achievements (code, name, description, sort_order) VALUES
  ('FIRST_GAME',  'First Smile',   'Finish your first game.',                  1),
  ('FIRST_WIN',   'Champion',      'Win a game.',                              2),
  ('HIGH_SCORER', 'High Scorer',   'Score 1000 points or more in one game.',   3),
  ('SHARP_EYE',   'Sharp Eye',     'Guess 50 words correctly.',                4),
  ('ARTIST',      'Artist',        'Draw 25 words.',                           5),
  ('VETERAN',     'Veteran',       'Play 25 games.',                           6)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;
