-- Datakul layer 2: the shared library that grows from questions the library can't answer.
-- Apply with: npx wrangler d1 migrations apply datakul --remote

-- One row per unanswered question. Anonymous: PII is masked before storing, there is no user id,
-- and "asker" is a hash of the visitor's address and the day, so it can't be linked across days.
-- Rows are deleted after 180 days.
CREATE TABLE IF NOT EXISTS misses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  q TEXT NOT NULL,
  track TEXT,
  asker TEXT,
  day TEXT NOT NULL,
  vec TEXT NOT NULL,
  cluster_id INTEGER,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS misses_cluster ON misses(cluster_id);
CREATE INDEX IF NOT EXISTS misses_created ON misses(created);

-- Groups of similar questions. status: open → review → live, or rejected.
CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  centroid TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  askers INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  draft TEXT,
  checks TEXT,
  sample TEXT,
  note TEXT,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS clusters_status ON clusters(status);

-- Approved cards, served to every learner by GET /api/community.
CREATE TABLE IF NOT EXISTS published (
  id TEXT PRIMARY KEY,
  cluster_id INTEGER NOT NULL,
  card TEXT NOT NULL,
  approved INTEGER NOT NULL
);
