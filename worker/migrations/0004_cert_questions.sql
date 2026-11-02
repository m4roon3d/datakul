-- Certification practice questions written nightly by the gateway (see worker/src/certq.js).
-- Only questions that pass the automatic checks are stored. status: live, or withdrawn by the owner.
-- No learner data is involved: these are questions, never answers or progress.
CREATE TABLE IF NOT EXISTS cert_q (
  id TEXT PRIMARY KEY,
  cert TEXT NOT NULL,
  dom TEXT NOT NULL,
  q TEXT NOT NULL,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  model TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cert_q_cert ON cert_q(cert, status);
