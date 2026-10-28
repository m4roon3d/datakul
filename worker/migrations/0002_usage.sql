-- AI service status: one row per AI call. No question or answer text, only what's needed to see health and usage.
-- Rows older than 90 days are deleted by the nightly job.
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,          -- UTC date, when most free quotas reset
  ts INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  mode TEXT NOT NULL,         -- tutor, feedback, selfcheck, codereview, generate, cardify, draft, embed, ping
  ok INTEGER NOT NULL,
  status INTEGER,             -- HTTP status from the provider (429 = busy / out of quota)
  ms INTEGER,                 -- time to the first byte of the answer
  tin INTEGER NOT NULL DEFAULT 0,
  tout INTEGER NOT NULL DEFAULT 0,
  reported INTEGER NOT NULL DEFAULT 0,  -- 1 when token counts came from the provider, 0 when estimated (characters / 4)
  fallback INTEGER NOT NULL DEFAULT 0,  -- 1 when an earlier provider failed and this one answered
  rl_req INTEGER,             -- requests remaining, when the provider reports it (Groq does)
  rl_tok INTEGER,             -- tokens remaining in the current window, when reported
  err TEXT
);
CREATE INDEX IF NOT EXISTS usage_day ON usage(day);
CREATE INDEX IF NOT EXISTS usage_model ON usage(provider, model, ts);

-- Small key/value store, e.g. the result of the last nightly job.
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated INTEGER NOT NULL
);
