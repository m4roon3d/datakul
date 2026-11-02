-- Optional learner accounts (Google sign-in). Nothing here is used unless GOOGLE_CLIENT_ID is set.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,          -- "g:" + Google account id
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,  -- SHA-256 of the session token; the token itself is never stored
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_exp ON sessions (expires);
CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,           -- the learner's own progress, as JSON
  updated_at INTEGER NOT NULL
);
