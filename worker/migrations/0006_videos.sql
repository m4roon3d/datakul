-- Video quests: public YouTube videos the owner picks, analysed once by Gemini into chapters, key points and quizzes
-- (see worker/src/video.js). Learners only read published ones. id is the YouTube video id.
-- status: draft (analysed, waiting for the owner), live (shown in the app), hidden (taken down), failed (analysis didn't work).
-- No learner data is involved: progress stays on the device (or the learner's synced account).
CREATE TABLE IF NOT EXISTS video (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT,
  model TEXT,
  err TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS video_status ON video(status);
