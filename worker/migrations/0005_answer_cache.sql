-- Saved answers: when a learner asks a first question the library can ground, the AI's answer is kept so the next
-- learner who asks the same thing gets it straight away, without using any free AI allowance.
-- The key is a hash of the whole prompt (rules, level, length, library notes and the question), so any change to the
-- prompt or the library notes gives a new key. The question text itself is never stored.
-- Rows unused for 30 days are deleted by the nightly job.
CREATE TABLE IF NOT EXISTS answer_cache (
  k TEXT PRIMARY KEY,          -- SHA-256 of the prompt
  answer TEXT NOT NULL,
  provider TEXT NOT NULL,      -- who wrote it first
  model TEXT NOT NULL,
  created INTEGER NOT NULL,
  last_hit INTEGER,
  hits INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS answer_cache_used ON answer_cache(last_hit, created);

-- Answers served from the cache per UTC day, for the review page.
CREATE TABLE IF NOT EXISTS cache_day (
  day TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);
