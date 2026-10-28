# Datakul: notes for Claude

Datakul is quest-based learning for data engineering, analysis, science and architecture careers: a static web app,
an AI gateway on Cloudflare Workers, and a D1 database for community picks. Owner: Ramanaa (prefers plain language,
short answers, no jargon).

## Layout

- `web/`: the app, served as static files. Scripts load in this order: config.js, library.js, community.js, problems.js,
  diagrams.js, app.js, pyrunner.js, practice.js, quests.js. `admin.html` is the community review page.
- `web/library.js`: the concepts (`C`) and interview questions (`Q`), 225 and 420 as of 28 Oct 2026 and growing weekly.
  Content is written in `content/batches/batchNN.py`, checked with `node content/validate_batch.js <batch.json>` and merged
  with `content/merge_batch.js` (which stamps new concepts with an `nw` date). The syllabus source is
  `content/syllabus.txt`; wave 2 is written in the order of `content/queue.txt`. The weekly update follows
  `docs/weekly-content.md`.
- `worker/src/index.js`: AI gateway (providers, prompts, fallback). `worker/src/community.js`: layer 2 (collect unanswered
  questions, group nightly, draft, check, review, publish). `worker/migrations/`: D1 schema.
- `worker/src/grader.js` is generated from the grader in `web/app.js` by `node tools/sync-grader.mjs`. Never edit it by hand;
  CI fails if it is out of date.
- `tools/deploy.mjs`: the deploy, run by `.github/workflows/deploy.yml` on every merge to main.
- `tests/`: `gateway.mjs` and `layer2.mjs` (Node 22, D1 on built-in SQLite), `l2ui.py` (Playwright, needs
  `node tests/l2server.mjs 8788` running; screenshots go to `tests/out/`).

## Commands

- Tests: `node --no-warnings tests/gateway.mjs`, `node --no-warnings tests/layer2.mjs`,
  then `node tests/l2server.mjs 8788 &` and `python3 tests/l2ui.py`.
- After changing the grader in `web/app.js`: `node tools/sync-grader.mjs`.
- Brand files: `python3 tools/make_brand.py` (compass mark + Space Grotesk wordmark → `brand/`). Theme test: `python3 tests/themes.py`.

## Rules

- API keys and `ADMIN_TOKEN` live only in GitHub secrets and Cloudflare Worker secrets. Never commit them or put them in `web/`.
- `worker/wrangler.toml` keeps the placeholders (`database_id`, `ALLOWED_ORIGINS = "*"`, `SITE_URL = ""`); the deploy fills
  them in on the runner. `web/config.js` stays empty in the repo; the deploy writes the gateway address.
- Groq's free models change: check console.groq.com/docs/deprecations before adding a model.
- Privacy: questions sent to `/api/miss` are anonymous (PII masked, no IP stored, deleted after 180 days) and learners can opt
  out. Anything new that sends learner data off the device needs the privacy notice updated first.
- Colours come from the theme tokens in `web/index.html` (light, dark, black). Never hard-code a colour in a component;
  check new UI in all three themes and at phone width (the phone header must fit logo, chips and settings).
- Concept cards stay short: a takeaway, a diagram where it helps, an example; detail behind disclosures.

## Working agreement

- Branch from the latest `main`, open a PR, wait for CI. **Merge only when Ramanaa says "Merge"** (squash).
- A merge deploys to production. After a merge, check the Deploy run and report the app address from its summary.
- Say what was tested in a browser and what was tested live; never claim live behaviour that was only tested locally.
